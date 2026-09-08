const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/*
 * Sala:
 * {
 *   code,
 *   name,
 *   private,
 *   password,
 *   owner,
 *   members: Set
 * }
 */

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
            owner: id === room.owner
        }))
    };
}

io.on("connection", (socket) => {

    console.log("Usuário conectado:", socket.id);


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

        const code = generateRoomCode();

        const room = {
            code,
            name,
            private: privateRoom,
            password,
            owner: socket.id,
            members: new Set([socket.id])
        };

        rooms.set(code, room);

        socket.join(code);
        socket.data.roomCode = code;

        callback?.({
            ok: true,
            room: roomInfo(room)
        });

        console.log(`Sala criada: ${code}`);
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

        if (room.private && password !== room.password) {
            return callback?.({
                ok: false,
                error: "Senha incorreta."
            });
        }

        room.members.add(socket.id);

        socket.join(code);
        socket.data.roomCode = code;

        callback?.({
            ok: true,
            room: roomInfo(room)
        });

        socket.to(code).emit("member-joined", {
            id: socket.id
        });

        io.to(code).emit(
            "room-updated",
            roomInfo(room)
        );
    });


    /*
     * SAIR DA SALA
     */

    socket.on("leave-room", () => {
        leaveCurrentRoom(socket);
    });


    /*
     * SOLICITAR TRANSMISSÃO
     */

    socket.on("start-sharing", () => {

        const code = socket.data.roomCode;

        if (!code) return;

        const room = rooms.get(code);

        if (!room) return;

        if (room.owner !== socket.id) {
            return;
        }

        socket.to(code).emit("screen-sharing-started", {
            hostId: socket.id
        });
    });


    /*
     * PARAR TRANSMISSÃO
     */

    socket.on("stop-sharing", () => {

        const code = socket.data.roomCode;

        if (!code) return;

        socket.to(code).emit("screen-sharing-stopped");
    });


    /*
     * WEBRTC SIGNALING
     */

    socket.on("webrtc-offer", ({ target, offer }) => {

        io.to(target).emit("webrtc-offer", {
            from: socket.id,
            offer
        });
    });


    socket.on("webrtc-answer", ({ target, answer }) => {

        io.to(target).emit("webrtc-answer", {
            from: socket.id,
            answer
        });
    });


    socket.on("webrtc-ice-candidate", ({ target, candidate }) => {

        io.to(target).emit("webrtc-ice-candidate", {
            from: socket.id,
            candidate
        });
    });


    /*
     * DESCONEXÃO
     */

    socket.on("disconnect", () => {

        console.log(
            "Usuário desconectado:",
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

    socket.leave(code);

    socket.data.roomCode = null;


    /*
     * Se o dono saiu, transfere a propriedade
     * para outro membro.
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
     * Se não houver ninguém,
     * remove a sala.
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
    console.log(`Servidor: http://localhost:${PORT}`);
    console.log("");
});
