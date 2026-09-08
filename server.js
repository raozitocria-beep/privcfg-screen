```js
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
            code += chars[Math.floor(Math.random() * chars.length)];
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

        members: [...room.members].map((id) => {
            const user = room.users[id] || {};

            return {
                id: id,
                name: user.name || "Usuário",
                role: id === room.owner ? "owner" : (user.role || "member"),
                owner: id === room.owner
            };
        })
    };
}

function canTransmit(room, socketId) {
    if (!room) {
        return false;
    }

    if (room.owner === socketId) {
        return true;
    }

    const user = room.users[socketId];

    return user && user.role === "transmitter";
}

io.on("connection", (socket) => {
    console.log("Usuário conectado: " + socket.id);

    socket.on("set-name", (name, callback) => {
        name = String(name || "").trim().slice(0, 30);

        if (!name) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Digite um nome."
                });
            }

            return;
        }

        socket.data.userName = name;

        if (callback) {
            callback({
                ok: true,
                name: name
            });
        }

        console.log(name + " entrou no servidor.");
    });

    socket.on("create-room", (data, callback) => {
        const name = String(
            (data && data.name) || "Sala Privcfg"
        ).trim().slice(0, 40);

        const privateRoom = Boolean(data && data.private);

        const password = privateRoom
            ? String((data && data.password) || "")
            : "";

        if (privateRoom && password.length < 3) {
            if (callback) {
                callback({
                    ok: false,
                    error: "A senha precisa ter pelo menos 3 caracteres."
                });
            }

            return;
        }

        if (!socket.data.userName) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Defina seu nome primeiro."
                });
            }

            return;
        }

        const code = generateRoomCode();

        const room = {
            code: code,
            name: name,
            private: privateRoom,
            password: password,
            owner: socket.id,

            members: new Set([
                socket.id
            ]),

            users: {}
        };

        room.users[socket.id] = {
            name: socket.data.userName,
            role: "owner"
        };

        rooms.set(code, room);

        socket.join(code);
        socket.data.roomCode = code;

        if (callback) {
            callback({
                ok: true,
                room: roomInfo(room)
            });
        }

        console.log(
            "Sala criada: " +
            code +
            " por " +
            socket.data.userName
        );
    });

    socket.on("join-room", (data, callback) => {
        const code = String(
            (data && data.code) || ""
        ).trim().toUpperCase();

        const password = String(
            (data && data.password) || ""
        );

        const room = rooms.get(code);

        if (!room) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Sala não encontrada."
                });
            }

            return;
        }

        if (!socket.data.userName) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Defina seu nome primeiro."
                });
            }

            return;
        }

        if (room.private && password !== room.password) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Senha incorreta."
                });
            }

            return;
        }

        room.members.add(socket.id);

        room.users[socket.id] = {
            name: socket.data.userName,
            role: "member"
        };

        socket.join(code);
        socket.data.roomCode = code;

        if (callback) {
            callback({
                ok: true,
                room: roomInfo(room)
            });
        }

        socket.to(code).emit("member-joined", {
            id: socket.id,
            name: socket.data.userName,
            role: "member"
        });

        io.to(code).emit(
            "room-updated",
            roomInfo(room)
        );

        console.log(
            socket.data.userName +
            " entrou na sala " +
            code
        );
    });

    socket.on("set-member-role", (data, callback) => {
        const code = socket.data.roomCode;
        const room = rooms.get(code);

        if (!room) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Você não está em uma sala."
                });
            }

            return;
        }

        if (room.owner !== socket.id) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Somente o dono da sala pode alterar cargos."
                });
            }

            return;
        }

        const targetId = String(
            (data && data.targetId) || ""
        );

        const role = String(
            (data && data.role) || "member"
        );

        if (!room.members.has(targetId)) {
            if (callback) {
                callback({
                    ok: false,
                    error: "Membro não encontrado."
                });
            }

            return;
        }

        if (targetId === room.owner) {
            if (callback) {
                callback({
                    ok: false,
                    error: "O dono já possui permissão de transmissão."
                });
            }

            return;
        }

        if (role !== "member" && role !== "transmitter") {
            if (callback) {
                callback({
                    ok: false,
                    error: "Cargo inválido."
                });
            }

            return;
        }

        if (!room.users[targetId]) {
            return;
        }

        room.users[targetId].role = role;

        io.to(targetId).emit("role-updated", {
            targetId: targetId,
            role: role
        });

        io.to(code).emit(
            "room-updated",
            roomInfo(room)
        );

        if (callback) {
            callback({
                ok: true,
                role: role
            });
        }

        const targetName =
            (room.users[targetId] &&
                room.users[targetId].name) ||
            "Usuário";

        console.log(
            socket.data.userName +
            " alterou " +
            targetName +
            " para " +
            role
        );
    });

    socket.on("leave-room", () => {
        leaveCurrentRoom(socket);
    });

    socket.on("start-sharing", () => {
        const code = socket.data.roomCode;

        if (!code) {
            return;
        }

        const room = rooms.get(code);

        if (!room) {
            return;
        }

        if (!canTransmit(room, socket.id)) {
            socket.emit(
                "sharing-permission-denied",
                {
                    error: "Você não possui permissão para transmitir."
                }
            );

            return;
        }

        const user = room.users[socket.id];

        io.to(code).emit(
            "screen-sharing-started",
            {
                hostId: socket.id,
                hostName: (user && user.name) || "Usuário"
            }
        );

        console.log(
            ((user && user.name) || socket.id) +
            " iniciou uma transmissão na sala " +
            code
        );
    });

    socket.on("stop-sharing", () => {
        const code = socket.data.roomCode;

        if (!code) {
            return;
        }

        const room = rooms.get(code);

        if (!room) {
            return;
        }

        if (!canTransmit(room, socket.id)) {
            return;
        }

        io.to(code).emit("screen-sharing-stopped");

        console.log(
            socket.data.userName +
            " parou a transmissão na sala " +
            code
        );
    });

    socket.on("webrtc-offer", (data) => {
        if (!data) {
            return;
        }

        const target = data.target;
        const sdp = data.sdp;

        if (!target || !sdp) {
            return;
        }

        const code = socket.data.roomCode;
        const room = rooms.get(code);

        if (!room) {
            return;
        }

        if (!canTransmit(room, socket.id)) {
            return;
        }

        if (!room.members.has(target)) {
            return;
        }

        io.to(target).emit(
            "webrtc-offer",
            {
                sender: socket.id,
                sdp: sdp
            }
        );
    });

    socket.on("webrtc-answer", (data) => {
        if (!data) {
            return;
        }

        const target = data.target;
        const sdp = data.sdp;

        if (!target || !sdp) {
            return;
        }

        const code = socket.data.roomCode;
        const room = rooms.get(code);

        if (!room) {
            return;
        }

        if (!room.members.has(target)) {
            return;
        }

        io.to(target).emit(
            "webrtc-answer",
            {
                sender: socket.id,
                sdp: sdp
            }
        );
    });

    socket.on("webrtc-ice-candidate", (data) => {
        if (!data) {
            return;
        }

        const target = data.target;
        const candidate = data.candidate;

        if (!target || !candidate) {
            return;
        }

        const code = socket.data.roomCode;
        const room = rooms.get(code);

        if (!room) {
            return;
        }

        if (!room.members.has(target)) {
            return;
        }

        io.to(target).emit(
            "webrtc-ice-candidate",
            {
                sender: socket.id,
                candidate: candidate
            }
        );
    });

    socket.on("disconnect", () => {
        console.log(
            "Usuário desconectado: " +
            (socket.data.userName || socket.id)
        );

        leaveCurrentRoom(socket);
    });
});

function leaveCurrentRoom(socket) {
    const code = socket.data.roomCode;

    if (!code) {
        return;
    }

    const room = rooms.get(code);

    if (!room) {
        return;
    }

    if (canTransmit(room, socket.id)) {
        io.to(code).emit("screen-sharing-stopped");
    }

    room.members.delete(socket.id);

    delete room.users[socket.id];

    socket.leave(code);

    socket.data.roomCode = null;

    if (room.owner === socket.id) {
        const nextOwner = [...room.members][0];

        if (nextOwner) {
            room.owner = nextOwner;

            if (room.users[nextOwner]) {
                room.users[nextOwner].role = "owner";
            }

            io.to(code).emit(
                "owner-changed",
                {
                    owner: nextOwner
                }
            );
        }
    }

    if (room.members.size === 0) {
        rooms.delete(code);

        console.log(
            "Sala removida: " + code
        );

        return;
    }

    io.to(code).emit(
        "member-left",
        {
            id: socket.id,
            name: socket.data.userName || "Usuário"
        }
    );

    io.to(code).emit(
        "room-updated",
        roomInfo(room)
    );
}

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log("================================");
        console.log("       PRIVCFG SCREEN");
        console.log("================================");
        console.log("");
        console.log(
            "Servidor rodando na porta " + PORT
        );
        console.log("");
    }
);
```
