const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
    res.json({
        online: true,
        service: "Privcfg Screen"
    });
});

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 6; i++) {
            code += chars[
                Math.floor(Math.random() * chars.length)
            ];
        }

    } while (rooms.has(code));

    return code;
}

function roomInfo(room) {
    return {
        code: room.code,
        name: room.name,
        private: room.private,
        owner: room.owner,
        members: [...room.members].map(id => ({
            id,
            name: room.users[id]?.name || "Usuário",
            owner: id === room.owner
        }))
    };
}

io.on("connection", (socket) => {

    console.log("Usuário conectado:", socket.id);

    /*
     * DEFINIR NOME
     */

    socket.on("set-name", (name, callback) => {

        name = String(name || "")
            .trim()
            .slice(0, 30);

        if (!name) {
            return callback?.({
                ok: false,
                error: "Digite um nome."
            });
        }

        socket.data.userName = name;

        callback?.({
            ok: true,
            name
        });

        console.log(`${name} entrou no servidor.`);

    });


    /*
     * CRIAR SALA
     */

    socket.on("create-room", (data, callback) => {

        const name =
            String(data?.name || "Sala Privcfg")
                .trim()
                .slice(0, 40);

        const privateRoom =
            Boolean(data?.private);

        const password =
            privateRoom
                ? String(data?.password || "")
                : "";

        if (privateRoom && password.length < 3) {
            return callback?.({
                ok: false,
                error: "A senha precisa ter pelo menos 3 caracteres."
            });
        }

        if (!socket.data.userName) {
            return callback?.({
                ok: false,
                error: "Defina seu nome primeiro."
            });
        }

        const code = generateRoomCode();

        const room = {
            code,
            name,
            private: privateRoom,
            password,
            owner: socket.id,
            members: new Set([socket.id]),
            users: {
                [socket.id]: {
                    name: socket.data.userName
                }
            }
        };

        rooms.set(code, room);

        socket.join(code);
        socket.data.roomCode = code;

        callback?.({
            ok: true,
            room: roomInfo(room)
        });

        console.log(
            `Sala criada: ${code} por ${socket.data.userName}`
        );

    });


    /*
     * ENTRAR EM SALA
     */

    socket.on("join-room", (data, callback) => {

        const code =
            String(data?.code || "")
                .trim()
                .toUpperCase();

        const password =
            String(data?.password || "");

        const room = rooms.get(code);

        if (!room) {
            return callback?.({
                ok: false,
                error: "Sala não encontrada."
            });
        }

        if (!socket.data.userName) {
            return callback?.({
                ok: false,
                error: "Defina seu nome primeiro."
            });
        }

        if (room.private && password !== room.password) {
            return callback?.({
                ok: false,
                error: "Senha incorreta."
            });
        }

        room.members.add(socket.id);

        room.users[socket.id] = {
            name: socket.data.userName
        };

        socket.join(code);
        socket.data.roomCode = code;

        callback?.({
            ok: true,
            room: roomInfo(room)
        });

        socket.to(code).emit("member-joined", {
            id: socket.id,
            name: socket.data.userName
        });

        io.to(code).emit(
            "room-updated",
            roomInfo(room)
        );

    });


    /*
     * SAIR
     */

    socket.on("leave-room", () => {
        leaveCurrentRoom(socket);
    });


    /*
     * INICIAR TRANSMISSÃO
     */

    socket.on("start-sharing", () => {

        const code = socket.data.roomCode;

        if (!code) return;

        const room = rooms.get(code);

        if (!room) return;

        if (room.owner !== socket.id) {
            return;
        }

        socket.to(code).emit(
            "screen-sharing-started",
            {
                hostId: socket.id
            }
        );

    });


    /*
     * PARAR TRANSMISSÃO
     */

    socket.on("stop-sharing", () => {

        const code = socket.data.roomCode;

        if (!code) return;

        socket.to(code).emit(
            "screen-sharing-stopped"
        );

    });


    /*
     * WEBRTC
     */

    socket.on(
        "webrtc-offer",
        ({ target, offer }) => {

            io.to(target).emit(
                "webrtc-offer",
                {
                    from: socket.id,
                    offer
                }
            );

        }
    );


    socket.on(
        "webrtc-answer",
        ({ target, answer }) => {

            io.to(target).emit(
                "webrtc-answer",
                {
                    from: socket.id,
                    answer
                }
            );

        }
    );


    socket.on(
        "webrtc-ice-candidate",
        ({ target, candidate }) => {

            io.to(target).emit(
                "webrtc-ice-candidate",
                {
                    from: socket.id,
                    candidate
                }
            );

        }
    );


    /*
     * DESCONEXÃO
     */

    socket.on("disconnect", () => {

        console.log(
            "Usuário desconectado:",
            socket.data.userName ||
            socket.id
        );

        leaveCurrentRoom(socket);

    });

});


function leaveCurrentRoom(socket) {

    const code = socket.data.roomCode;

    if (!code) return;

    const room = rooms.get(code);

    if (!room) return;

    room.members.delete(socket.id);

    delete room.users[socket.id];

    socket.leave(code);

    socket.data.roomCode = null;


    /*
     * Se o dono sair,
     * passa para outro membro.
     */

    if (room.owner === socket.id) {

        const nextOwner =
            [...room.members][0];

        if (nextOwner) {

            room.owner = nextOwner;

            io.to(code).emit(
                "owner-changed",
                {
                    owner: nextOwner
                }
            );

        }

    }


    /*
     * Se a sala ficou vazia,
     * remove.
     */

    if (room.members.size === 0) {

        rooms.delete(code);

        console.log(
            `Sala removida: ${code}`
        );

        return;

    }


    io.to(code).emit(
        "member-left",
        {
            id: socket.id
        }
    );

    io.to(code).emit(
        "room-updated",
        roomInfo(room)
    );

}


server.listen(PORT, () => {

    console.log("");
    console.log("================================");
    console.log("       PRIVCFG SCREEN");
    console.log("================================");
    console.log("");
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log("");

});
