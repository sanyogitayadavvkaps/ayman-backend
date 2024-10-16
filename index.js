import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const port = process.env.PORT;

// Enable CORS for all routes
app.use(cors());

app.get("/", (req, res) => {
  return res
    .status(200)
    .json({ success: true, message: "Socket API is running" });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  },
});

let waiting_queue = [];
let active_sessions = [];
let messages = {};
let skipped_sessions = {};
let active_sessions_users = {};

io.on("connection", (socket) => {
  const user_token = socket.id;
  socket.emit("getWaitingRooms", { waiting_queue, active_sessions_users });

  // Triggered when a peer hits the join room button
  socket.on("join", ({roomId:roomName,userskip=false}) => {
    if (!roomName) return;
    const room = io.sockets.adapter.rooms.get(roomName);

    // Create a new room if no such room exists
    if (room === undefined || userskip) {
      console.log("room does not exist",roomName,waiting_queue);
      socket.join(roomName);
      socket.emit("created");
      messages[roomName] = [];
      if (!waiting_queue.includes(roomName)) {
        console.log("pushing room to waiting queue",roomName);
        waiting_queue.push(roomName);
      }
      active_sessions_users[roomName] = [user_token];
      updateRoomState();
    } 
    // If there is only one person in the room
    else if (room.size === 1) {
      console.log("room size is 1",roomName);
      socket.join(roomName);
      socket.emit("joined");
      waiting_queue = waiting_queue.filter((room) => room !== roomName);
      active_sessions.push(roomName);
      active_sessions_users[roomName].push(user_token);
      updateRoomState();
    } 
    // Room is full
    else {
      socket.emit("full");
    }
  });

  // Triggered when the person who joined the room is ready to communicate
  socket.on("ready", (roomName) => {
    socket.broadcast.to(roomName).emit("ready");
  });

  // Triggered when server gets an icecandidate from a peer in the room
  socket.on("ice-candidate", (candidate, roomName) => {
    socket.broadcast.to(roomName).emit("ice-candidate", candidate);
  });

  // Triggered when server gets an offer from a peer in the room
  socket.on("offer", (offer, roomName) => {
    socket.broadcast.to(roomName).emit("offer", offer);
  });

  // Triggered when server gets an answer from a peer in the room
  socket.on("answer", (answer, roomName) => {
    socket.broadcast.to(roomName).emit("answer", answer);
  });

  // Handles user leaving the room and adds the room to the waiting queue
  socket.on("onLeave", (roomName) => {
    console.log("onLeave", roomName);
    socket.leave(roomName);
    active_sessions = active_sessions.filter((room) => room !== roomName);
    messages[roomName] = [];
    active_sessions_users[roomName] = active_sessions_users[roomName].filter((user) => user !== user_token);

    // Only add the room back to waiting queue if it's empty
    if (active_sessions_users[roomName]?.length === 0) {
      waiting_queue.push(roomName);
    }

    updateRoomState();
    socket.emit("getWaitingRooms", { waiting_queue, active_sessions_users });
    socket.broadcast.to(roomName).emit("leave");
  });

  // Handles when a user skips the room
  socket.on("skip", (roomName) => {
    active_sessions = active_sessions.filter((room) => room !== roomName);
    messages[roomName] = [];

    if (!skipped_sessions[user_token]) {
      skipped_sessions[user_token] = [roomName];
    } else {
      skipped_sessions[user_token].push(roomName);
    }

    socket.emit("skipped_users", skipped_sessions[user_token]);
    socket.broadcast.to(roomName).emit("skipped_users", skipped_sessions[user_token]);

    if (active_sessions_users[roomName]) {
      active_sessions_users[roomName] = active_sessions_users[roomName].filter((user) => user !== user_token);
    }

    updateRoomState();
    socket.leave(roomName);
  });


 //message send
  socket.on("message_send", (data) => {
    console.log("message_send", data, Array.isArray(messages[data.roomName]));
    if (!Array.isArray(messages[data.roomName])) messages[data.roomName] = [];
    console.log("sender", socket.id, messages);
    messages[data.roomName].push({
      sender: socket.id,
      message: data.message,
    });

    socket.broadcast
      .to(data.roomName)
      .emit("message_recieved", messages[data.roomName]);
  });

  // Helper function to update room state
  function updateRoomState() {
    io.emit("getWaitingRooms", { waiting_queue, active_sessions_users });
  }
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
