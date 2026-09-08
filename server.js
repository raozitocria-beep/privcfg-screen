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

/* =====================================
GERAR CÓDIGO DA SALA
===================================== */

function generateRoomCode() {

```
const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let code;

do {

    code = "";

    for (let i = 0; i < 6; i++) {

        code += chars[
            Math.floor(
                Math.random() * chars.length
            )
        ];

    }

} while (rooms.has(code));

return code;
```

}

/* =====================================
INFORMAÇÕES DA SALA
===================================== */

function roomInfo(room) {

```
return {
    code: room.code,
    name: room.name,
    private: room.private,
    owner: room.owner,

    members: [...room.members].map(id => {

        const user =
            room.users[id] || {};

        return {
            id,
            name: user.name || "Usuário",

            role:
                id === room.owner
                    ? "owner"
                    : user.role || "member",

            owner:
                id === room.owner
        };

    })
};
```

}

/* =====================================
VERIFICAR SE PODE TRANSMITIR
===================================== */

function canTransmit(room, socketId) {

```
if (!room)
    return false;

if (room.owner === socketId)
    return true;

const user =
    room.users[socketId];

return user?.role === "transmitter";
```

}

/* =====================================
SOCKET.IO
===================================== */

io.on("connection", (socket) => {

```
console.log(
    "Usuário conectado:",
    socket.id
);

/* =================================
   DEFINIR NOME
================================= */

socket.on(
    "set-name",
    (name, callback) => {

        name =
            String(name || "")
                .trim()
                .slice(0, 30);

        if (!name) {

            return callback?.({
                ok: false,
                error: "Digite um nome."
            });

        }

        socket.data.userName =
            name;

        callback?.({
            ok: true,
            name
        });

        console.log(
            `${name} entrou no servidor.`
        );

    }
);

/* =================================
   CRIAR SALA
================================= */

socket.on(
    "create-room",
    (data, callback) => {

        const name =
            String(
                data?.name ||
                "Sala Privcfg"
            )
                .trim()
                .slice(0, 40);

        const privateRoom =
            Boolean(data?.private);

        const password =
            privateRoom
                ? String(
                    data?.password || ""
                )
                : "";

        if (
            privateRoom &&
            password.length < 3
        ) {

            return callback?.({
                ok: false,
                error:
                    "A senha precisa ter pelo menos 3 caracteres."
            });

        }

        if (
            !socket.data.userName
        ) {

            return callback?.({
                ok: false,
                error:
                    "Defina seu nome primeiro."
            });

        }

        const code =
            generateRoomCode();

        const room = {

            code,

            name,

            private:
                privateRoom,

            password,

            owner:
                socket.id,

            members:
                new Set([
                    socket.id
                ]),

            users: {

                [socket.id]: {

                    name:
                        socket.data
                            .userName,

                    role:
                        "owner"

                }

            }

        };

        rooms.set(
            code,
            room
        );

        socket.join(code);

        socket.data.roomCode =
            code;

        callback?.({
            ok: true,
            room:
                roomInfo(room)
        });

        console.log(
            `Sala criada: ${code} por ${socket.data.userName}`
        );

    }
);

/* =================================
   ENTRAR NA SALA
================================= */

socket.on(
    "join-room",
    (data, callback) => {

        const code =
            String(
                data?.code || ""
            )
                .trim()
                .toUpperCase();

        const password =
            String(
                data?.password || ""
            );

        const room =
            rooms.get(code);

        if (!room) {

            return callback?.({
                ok: false,
                error:
                    "Sala não encontrada."
            });

        }

        if (
            !socket.data.userName
        ) {

            return callback?.({
                ok: false,
                error:
                    "Defina seu nome primeiro."
            });

        }

        if (
            room.private &&
            password !== room.password
        ) {

            return callback?.({
                ok: false,
                error:
                    "Senha incorreta."
            });

        }

        room.members.add(
            socket.id
        );

        room.users[socket.id] = {

            name:
                socket.data.userName,

            role:
                "member"

        };

        socket.join(code);

        socket.data.roomCode =
            code;

        callback?.({
            ok: true,
            room:
                roomInfo(room)
        });

        socket.to(code).emit(
            "member-joined",
            {
                id:
                    socket.id,

                name:
                    socket.data
                        .userName,

                role:
                    "member"
            }
        );

        io.to(code).emit(
            "room-updated",
            roomInfo(room)
        );

    }
);

/* =================================
   DAR / REMOVER CARGO
================================= */

socket.on(
    "set-member-role",
    (data, callback) => {

        const code =
            socket.data.roomCode;

        const room =
            rooms.get(code);

        if (!room) {

            return callback?.({
                ok: false,
                error:
                    "Você não está em uma sala."
            });

        }

        /*
         * SOMENTE O DONO
         * PODE ALTERAR CARGOS.
         */

        if (
            room.owner !== socket.id
        ) {

            return callback?.({
                ok: false,
                error:
                    "Somente o dono da sala pode alterar cargos."
            });

        }

        const targetId =
            String(
                data?.targetId || ""
            );

        const role =
            String(
                data?.role || "member"
            );

        if (
            !room.members.has(
                targetId
            )
        ) {

            return callback?.({
                ok: false,
                error:
                    "Membro não encontrado."
            });

        }

        /*
         * O DONO NÃO PODE
         * RECEBER/REMOVER O PRÓPRIO
         * CARGO.
         */

        if (
            targetId ===
            room.owner
        ) {

            return callback?.({
                ok: false,
                error:
                    "O dono já possui permissão de transmissão."
            });

        }

        if (
            role !== "member" &&
            role !== "transmitter"
        ) {

            return callback?.({
                ok: false,
                error:
                    "Cargo inválido."
            });

        }

        room.users[targetId].role =
            role;

        /*
         * Informa o membro
         * que o cargo mudou.
         */

        io.to(targetId).emit(
            "role-updated",
            {
                targetId,
                role
            }
        );

        /*
         * Atualiza todos os membros.
         */

        io.to(code).emit(
            "room-updated",
            roomInfo(room)
        );

        callback?.({
            ok: true,
            role
        });

        const targetName =
            room.users[targetId]
                ?.name ||
            "Usuário";

        console.log(
            `${socket.data.userName} alterou ${targetName} para ${role}`
        );

    }
);

/* =================================
   SAIR DA SALA
================================= */

socket.on(
    "leave-room",
    () => {

        leaveCurrentRoom(
            socket
        );

    }
);

/* =================================
   INICIAR TRANSMISSÃO
================================= */

socket.on(
    "start-sharing",
    () => {

        const code =
            socket.data.roomCode;

        if (!code)
            return;

        const room =
            rooms.get(code);

        if (!room)
            return;

        /*
         * DONO OU TRANSMISSOR
         */

        if (
            !canTransmit(
                room,
                socket.id
            )
        ) {

            socket.emit(
                "sharing-permission-denied",
                {
                    error:
                        "Você não possui permissão para transmitir."
                }
            );

            return;
        }

        const user =
            room.users[
                socket.id
            ];

        io.to(code).emit(
            "screen-sharing-started",
            {
                hostId:
                    socket.id,

                hostName:
                    user?.name ||
                    "Usuário"
            }
        );

        console.log(
            `${user?.name || socket.id} iniciou uma transmissão na sala ${code}`
        );

    }
);

/* =================================
   PARAR TRANSMISSÃO
================================= */

socket.on(
    "stop-sharing",
    () => {

        const code =
            socket.data.roomCode;

        if (!code)
            return;

        const room =
            rooms.get(code);

        if (!room)
            return;

        /*
         * Somente quem possui
         * permissão de transmissão
         * pode parar.
         */

        if (
            !canTransmit(
                room,
                socket.id
            )
        ) {
            return;
        }

        io.to(code).emit(
            "screen-sharing-stopped"
        );

    }
);

/* =================================
   WEBRTC OFFER
================================= */

socket.on(
    "webrtc-offer",
    ({ target, sdp }) => {

        if (!target || !sdp)
            return;

        const code =
            socket.data.roomCode;

        const room =
            rooms.get(code);

        if (!room)
            return;

        /*
         * Apenas transmissor/dono
         * pode enviar a transmissão.
         */

        if (
            !canTransmit(
                room,
                socket.id
            )
        ) {
            return;
        }

        io.to(target).emit(
            "webrtc-offer",
            {
                sender:
                    socket.id,

                sdp
            }
        );

    }
);

/* =================================
   WEBRTC ANSWER
================================= */

socket.on(
    "webrtc-answer",
    ({ target, sdp }) => {

        if (!target || !sdp)
            return;

        const code =
            socket.data.roomCode;

        const room =
            rooms.get(code);

        if (!room)
            return;

        /*
         * O receptor pode enviar
         * a resposta normalmente.
         */

        io.to(target).emit(
            "webrtc-answer",
            {
                sender:
                    socket.id,

                sdp
            }
        );

    }
);

/* =================================
   ICE
================================= */

socket.on(
    "webrtc-ice-candidate",
    ({ target, candidate }) => {

        if (
            !target ||
            !candidate
        )
            return;

        const code =
            socket.data.roomCode;

        const room =
            rooms.get(code);

        if (!room)
            return;

        /*
         * Só permite sinalização
         * dentro da própria sala.
         */

        if (
            !room.members.has(
                target
            )
        ) {
            return;
        }

        io.to(target).emit(
            "webrtc-ice-candidate",
            {
                sender:
                    socket.id,

                candidate
            }
        );

    }
);

/* =================================
   DESCONEXÃO
================================= */

socket.on(
    "disconnect",
    () => {

        console.log(
            "Usuário desconectado:",
            socket.data.userName ||
            socket.id
        );

        leaveCurrentRoom(
            socket
        );

    }
);
```

});

/* =====================================
SAIR DA SALA
===================================== */

function leaveCurrentRoom(socket) {

```
const code =
    socket.data.roomCode;

if (!code)
    return;

const room =
    rooms.get(code);

if (!room)
    return;

/*
 * Se estava transmitindo,
 * avisa todos.
 */

if (
    canTransmit(
        room,
        socket.id
    )
) {

    io.to(code).emit(
        "screen-sharing-stopped"
    );

}

room.members.delete(
    socket.id
);

delete room.users[
    socket.id
];

socket.leave(code);

socket.data.roomCode =
    null;

/*
 * Se o dono sair,
 * passa o cargo para outro membro.
 */

if (
    room.owner === socket.id
) {

    const nextOwner =
        [...room.members][0];

    if (nextOwner) {

        room.owner =
            nextOwner;

        /*
         * O novo dono recebe
         * automaticamente o cargo owner.
         */

        if (
            room.users[
                nextOwner
            ]
        ) {

            room.users[
                nextOwner
            ].role =
                "owner";

        }

        io.to(code).emit(
            "owner-changed",
            {
                owner:
                    nextOwner
            }
        );

    }

}

/*
 * Sala vazia.
 */

if (
    room.members.size === 0
) {

    rooms.delete(code);

    console.log(
        `Sala removida: ${code}`
    );

    return;
}

/*
 * Avisar que membro saiu.
 */

io.to(code).emit(
    "member-left",
    {
        id:
            socket.id,

        name:
            socket.data
                .userName ||
            "Usuário"
    }
);

/*
 * Atualizar lista.
 */

io.to(code).emit(
    "room-updated",
    roomInfo(room)
);
```

}

/* =====================================
SERVIDOR
===================================== */

server.listen(
PORT,
"0.0.0.0",
() => {

```
    console.log("");
    console.log(
        "================================"
    );
    console.log(
        "       PRIVCFG SCREEN"
    );
    console.log(
        "================================"
    );
    console.log("");
    console.log(
        `Servidor rodando na porta ${PORT}`
    );
    console.log("");

}
```

);
