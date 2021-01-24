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
const corsOptions = {
  origin: (origin, callback) => {
    if (
      whitelist.includes(origin) ||
      whitelist.filter((url) => url.test && url.test(origin)).length ||
      !origin
    ) {
      console.log(`Allowed by CORS: ${origin}`);
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

const whitelist = [/localhost/, /vercel\.app/];

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

// authenticate user via token on every request
// app.use((req, res, next) => {
//   const { token } = req.cookies;

//   if (token) {
//     try {
//       const { userId } = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
//       req.userId = userId;
//     } catch (err) {
//       console.log(err);
//     }
//   } else {
//     console.warn("No token present.");
//   }
//   next();
// });

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

// assign port
app.set("port", process.env.PORT || 7000);

// start server
server.listen(app.get("port"), () => {
  if (process.env.SILENCE_LOGS !== "true") {
    // notify console of server boot
    console.log(`http://localhost:${app.get("port")}`);
  }
});

/*************************/
/*** INTERESTING STUFF ***/
/*************************/
var channels = {};
var sockets = {};

/**
 * Users will connect to the signaling server, after which they'll issue a "join"
 * to join a particular channel. The signaling server keeps track of all sockets
 * who are in a channel, and on join will send out 'addPeer' events to each pair
 * of users in a channel. When clients receive the 'addPeer' even they'll begin
 * setting up an RTCPeerConnection with one another. During this process they'll
 * need to relay ICECandidate information to one another, as well as SessionDescription
 * information. After all of that happens, they'll finally be able to complete
 * the peer connection and will be streaming audio/video between eachother.
 */
io.sockets.on("connection", function (socket) {
  socket.channels = {};
  sockets[socket.id] = socket;

  console.log("[" + socket.id + "] connection accepted");
  socket.on("disconnect", function () {
    for (var channel in socket.channels) {
      part(channel);
    }
    console.log("[" + socket.id + "] disconnected");
    delete sockets[socket.id];
  });

  socket.on("join", function (config) {
    console.log("[" + socket.id + "] join ", config);
    var channel = config.channel;
    var userdata = config.userdata;

    if (channel in socket.channels) {
      console.log("[" + socket.id + "] ERROR: already joined ", channel);
      return;
    }

    if (!(channel in channels)) {
      channels[channel] = {};
    }

    for (id in channels[channel]) {
      channels[channel][id].emit("addPeer", {
        peer_id: socket.id,
        should_create_offer: false,
      });
      socket.emit("addPeer", { peer_id: id, should_create_offer: true });
    }

    channels[channel][socket.id] = socket;
    socket.channels[channel] = channel;
  });

  function part(channel) {
    console.log("[" + socket.id + "] part ");

    if (!(channel in socket.channels)) {
      console.log("[" + socket.id + "] ERROR: not in ", channel);
      return;
    }

    delete socket.channels[channel];
    delete channels[channel][socket.id];

    for (id in channels[channel]) {
      channels[channel][id].emit("removePeer", { peer_id: socket.id });
      socket.emit("removePeer", { peer_id: id });
    }
  }
  socket.on("part", part);

  socket.on("relayICECandidate", function (config) {
    var peer_id = config.peer_id;
    var ice_candidate = config.ice_candidate;
    console.log(
      "[" + socket.id + "] relaying ICE candidate to [" + peer_id + "] ",
      ice_candidate
    );

    if (peer_id in sockets) {
      sockets[peer_id].emit("iceCandidate", {
        peer_id: socket.id,
        ice_candidate: ice_candidate,
      });
    }
  });

  socket.on("relaySessionDescription", function (config) {
    var peer_id = config.peer_id;
    var session_description = config.session_description;
    console.log(
      "[" + socket.id + "] relaying session description to [" + peer_id + "] ",
      session_description
    );

    if (peer_id in sockets) {
      sockets[peer_id].emit("sessionDescription", {
        peer_id: socket.id,
        session_description: session_description,
      });
    }
  });
});
