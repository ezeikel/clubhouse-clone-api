const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cookierParser = require("cookie-parser");
// const Sentry = require("@sentry/node");
// const jwt = require("jsonwebtoken");
require("colors");
const debug = require("debug")("clubhouse-clone-api:server");
// import environment variables from the .env file
if (process.env.NODE_ENV !== "staging" && process.env.NODE_ENV !== "production")
  require("dotenv").config({ path: ".env" });

// Sentry.init({
//   enabled:
//     process.env.NODE_ENV === "staging" || process.env.NODE_ENV === "production",
//   environment: process.env.NODE_ENV,
//   dsn:
//     "https://562a46543eeb4a78acb376566d57fb6c@o402134.ingest.sentry.io/5265478",
// });

const app = express();
const server = require("http").createServer(app);

const whitelist = [/localhost/, /vercel\.app/, /versy\.app/];
const corsOptions = {
  origin: (origin, callback) => {
    if (
      whitelist.includes(origin) ||
      whitelist.filter((url) => url.test && url.test(origin)).length ||
      !origin
    ) {
      callback(null, true);
    } else {
      console.error(`Not allowed by CORS: ${origin}`);
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
};

const io = require("socket.io")(server, {
  cors: corsOptions,
});

// enable cors
app.use(cors(corsOptions));

app.use(express.static("public"));

// body parser facilitates grabbing info from POST requests
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));

// log all requests to the console
if (process.env.SILENCE_LOGS != "true") {
  app.use(morgan("dev"));
}

app.use(cookierParser());

app.use("/api", require("./api"));
app.use("/", (req, res) => {
  res.send({ response: "I am alive" }).status(200);
});

// // 404 error handler - throw error to ensure consistent responses (from error handler below)
app.use((req, res) => {
  // throw new NotFoundError("Route not found", 2771555531);
  res.status(404).json({
    message: "Route not found.",
  });
});

const users = {};
const socketToRoom = {};

io.on("connection", (socket) => {
  socket.on("join room", ({ roomId, muted }) => {
    if (users[roomId]) {
      const length = users[roomId].length;
      if (length === 4) {
        socket.emit("room full");
        return;
      }
      users[roomId].push({
        socketId: socket.id,
        muted,
      });
    } else {
      users[roomId] = [{ socketId: socket.id, muted }];
    }
    socketToRoom[socket.id] = roomId;

    console.log({ socketId: socket.id, roomId });

    // so we can emit events to the whole room later
    socket.join(roomId);

    // TODO: should this filter out the socket that just joined?
    const usersInThisRoom = users[roomId].filter(
      ({ socketId }) => socketId !== socket.id
    );

    console.log({ usersInThisRoom });

    // so that the front end knows which peers to render
    io.in(roomId).emit("all users", usersInThisRoom);
  });

  socket.on("sending signal", (payload) => {
    io.to(payload.userToSignal).emit("user joined", {
      signal: payload.signal,
      callerID: payload.callerID,
    });
  });

  socket.on("returning signal", (payload) => {
    io.to(payload.callerID).emit("receiving returned signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  socket.on("sending mutechange", (payload) => {
    const roomId = socketToRoom[payload.peerID];

    // update server copy of users
    users[roomId] = users[roomId].map((user) => {
      if (user.socketId === payload.peerID) {
        return {
          ...user,
          muted: payload.muted,
        };
      }

      return user;
    });

    if (roomId) {
      socket.to(roomId).emit("returning mutechange", {
        peerID: payload.peerID,
        muted: payload.muted,
      });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socketToRoom[socket.id];
    let room = users[roomId];
    if (room) {
      room = room.filter((id) => id !== socket.id);
      users[roomId] = room;

      // ?
      socket.broadcast.emit("user left", socket.id);
    }
  });

  socket.on("disconnecting", () => {
    console.log(socket.rooms); // the Set contains at least the socket ID
  });
});

// assign port
app.set("port", process.env.PORT || 7000);

// start server
server.listen(app.get("port"), () => {
  if (process.env.SILENCE_LOGS !== "true") {
    // notify console of server boot
    console.log(`http://localhost:${app.get("port")}`);
  }
});
