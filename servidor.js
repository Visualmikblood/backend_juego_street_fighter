import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// Variables para control de intervalos
let gameLoopInterval = null;
let gameTimer = null;

// Configuración básica HTTP
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Servidor Street Fighter funcionando',
    socket: `ws://${req.get('host')}`,
    players: {
      player1: !!gameState.player1,
      player2: !!gameState.player2
    }
  });
});

// Configuración Socket.IO
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"]
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,
    skipMiddlewares: true
  }
});

// Estado del juego
let gameState = {
  player1: null,
  player2: null,
  player1Keys: {},
  player2Keys: {},
  game: {
    player1: {
      x: 100, y: 300, hp: 100, maxHp: 100, facing: 'right',
      isAttacking: false, isBlocking: false, isJumping: false,
      jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
    },
    player2: {
      x: 600, y: 300, hp: 100, maxHp: 100, facing: 'left',
      isAttacking: false, isBlocking: false, isJumping: false,
      jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
    },
    gameStarted: false,
    winner: null,
    round: 1,
    timer: 90
  }
};

// Funciones de broadcast
const broadcastPlayersUpdate = () => {
  const connectedPlayers = 
    (gameState.player1 ? 1 : 0) + (gameState.player2 ? 1 : 0);
  io.emit("playersUpdate", {
    player1Connected: !!gameState.player1,
    player2Connected: !!gameState.player2,
    total: connectedPlayers,
    gameStatus: gameState.game.gameStarted ? 'running' : 'waiting'
  });
};

const broadcastGameState = () => {
  try {
    io.emit("gameStateUpdate", gameState.game);
  } catch (error) {
    console.error("Error broadcasting game state:", error);
  }
};

// Función de ataque
const performAttack = (attacker, defender, type = 'normal') => {
  const distance = Math.abs(attacker.x - defender.x);
  if (distance < 80) {
    let damage = type === 'special' ? 25 : 15;
    if (attacker.combo > 0) damage += Math.floor(attacker.combo * 2);

    if (defender.isBlocking) {
      damage *= 0.3;
      return { hp: Math.max(0, defender.hp - damage), breakCombo: true };
    } else {
      return { hp: Math.max(0, defender.hp - damage), breakCombo: false };
    }
  }
  return { hp: defender.hp, breakCombo: false };
};

// Game loop
const gameLoop = () => {
  try {
    if (!gameState.game.gameStarted || gameState.game.winner) return;

    const newGame = { ...gameState.game };

    // Jugador 1 - Movimiento
    const p1Keys = gameState.player1Keys;
    if (p1Keys['a'] && newGame.player1.x > 50) {
      newGame.player1.x -= 5;
      newGame.player1.facing = 'left';
    }
    if (p1Keys['d'] && newGame.player1.x < 720) {
      newGame.player1.x += 5;
      newGame.player1.facing = 'right';
    }
    if (p1Keys['w'] && !newGame.player1.isJumping) {
      newGame.player1.isJumping = true;
      newGame.player1.jumpVelocity = -15;
    }
    newGame.player1.isBlocking = p1Keys['g'] || false;

    // Jugador 1 - Ataques
    if (p1Keys['f'] && !newGame.player1.isAttacking) {
      newGame.player1.isAttacking = true;
      newGame.player1.lastAttackTime = Date.now();
      const result = performAttack(newGame.player1, newGame.player2);
      newGame.player2.hp = result.hp;
      newGame.player1.combo = result.breakCombo ? 0 : newGame.player1.combo + 1;
      setTimeout(() => {
        gameState.game.player1.isAttacking = false;
        broadcastGameState();
      }, 200);
    }

    if (p1Keys['h'] && newGame.player1.special >= 50) {
      newGame.player1.special -= 50;
      const result = performAttack(newGame.player1, newGame.player2, 'special');
      newGame.player2.hp = result.hp;
      newGame.player1.combo += 1;
    }

    // Jugador 2 - Movimiento
    const p2Keys = gameState.player2Keys;
    if (p2Keys['arrowleft'] && newGame.player2.x > 50) {
      newGame.player2.x -= 5;
      newGame.player2.facing = 'left';
    }
    if (p2Keys['arrowright'] && newGame.player2.x < 720) {
      newGame.player2.x += 5;
      newGame.player2.facing = 'right';
    }
    if (p2Keys['arrowup'] && !newGame.player2.isJumping) {
      newGame.player2.isJumping = true;
      newGame.player2.jumpVelocity = -15;
    }
    newGame.player2.isBlocking = p2Keys['2'] || false;

    // Jugador 2 - Ataques
    if (p2Keys['1'] && !newGame.player2.isAttacking) {
      newGame.player2.isAttacking = true;
      newGame.player2.lastAttackTime = Date.now();
      const result = performAttack(newGame.player2, newGame.player1);
      newGame.player1.hp = result.hp;
      newGame.player2.combo = result.breakCombo ? 0 : newGame.player2.combo + 1;
      setTimeout(() => {
        gameState.game.player2.isAttacking = false;
        broadcastGameState();
      }, 200);
    }

    if (p2Keys['3'] && newGame.player2.special >= 50) {
      newGame.player2.special -= 50;
      const result = performAttack(newGame.player2, newGame.player1, 'special');
      newGame.player1.hp = result.hp;
      newGame.player2.combo += 1;
    }

    // Física del juego
    [newGame.player1, newGame.player2].forEach(player => {
      if (player.isJumping) {
        player.y += player.jumpVelocity;
        player.jumpVelocity += 1;
        if (player.y >= 300) {
          player.y = 300;
          player.isJumping = false;
          player.jumpVelocity = 0;
        }
      }
    });

    // Regeneración de energía
    if (newGame.player1.special < 100) newGame.player1.special += 0.5;
    if (newGame.player2.special < 100) newGame.player2.special += 0.5;

    // Reset de combos
    const now = Date.now();
    if (now - newGame.player1.lastAttackTime > 2000) newGame.player1.combo = 0;
    if (now - newGame.player2.lastAttackTime > 2000) newGame.player2.combo = 0;

    // Verificación de ganador
    if (newGame.player1.hp <= 0) newGame.winner = 'Player 2';
    else if (newGame.player2.hp <= 0) newGame.winner = 'Player 1';

    gameState.game = newGame;
    broadcastGameState();

  } catch (error) {
    console.error("Error in game loop:", error);
  }
};

// Timer del juego
const startGameTimer = () => {
  if (gameTimer) clearInterval(gameTimer);
  gameTimer = setInterval(() => {
    if (gameState.game.gameStarted && !gameState.game.winner) {
      gameState.game.timer -= 1;
      if (gameState.game.timer <= 0) {
        const winner = gameState.game.player1.hp > gameState.game.player2.hp ? 'Player 1' :
                      gameState.game.player2.hp > gameState.game.player1.hp ? 'Player 2' : 'Draw';
        gameState.game.winner = winner;
        gameState.game.timer = 0;
        clearInterval(gameTimer);
      }
      broadcastGameState();
    }
  }, 1000);
};

// Iniciar game loop
const startGameLoop = () => {
  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(gameLoop, 16);
};

// Conexiones Socket.IO
io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] User connected: ${socket.id}`);

  // Asignación de jugador
  if (!gameState.player1) {
    gameState.player1 = socket.id;
    socket.emit("playerAssignment", {
      role: "player1",
      controls: {
        left: "a", right: "d", jump: "w",
        attack: "f", block: "g", special: "h"
      },
      position: "left"
    });
    console.log(`Player 1 (WASD+FGH) assigned: ${socket.id}`);
  } else if (!gameState.player2) {
    gameState.player2 = socket.id;
    socket.emit("playerAssignment", {
      role: "player2",
      controls: {
        left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp",
        attack: "1", block: "2", special: "3"
      },
      position: "right"
    });
    console.log(`Player 2 (ArrowKeys+123) assigned: ${socket.id}`);
  } else {
    socket.emit("playerAssignment", { role: "spectator" });
    console.log(`Spectator assigned: ${socket.id}`);
  }

  // Enviar estado inicial
  broadcastPlayersUpdate();
  socket.emit("gameStateUpdate", gameState.game);

  // Manejo de acciones
  socket.on("playerAction", (data) => {
    if (!data || !data.keys) {
      return console.warn(`Invalid data from ${socket.id}`);
    }

    if (socket.id === gameState.player1) {
      gameState.player1Keys = data.keys;
    } else if (socket.id === gameState.player2) {
      gameState.player2Keys = data.keys;
    }
  });

  // Inicio del juego
  socket.on("startGame", () => {
    if ((socket.id !== gameState.player1 && socket.id !== gameState.player2) || 
        gameState.game.gameStarted) {
      return;
    }

    console.log(`Game started by: ${socket.id}`);
    
    gameState.game = {
      player1: {
        x: 100, y: 300, hp: 100, maxHp: 100, facing: 'right',
        isAttacking: false, isBlocking: false, isJumping: false,
        jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
      },
      player2: {
        x: 600, y: 300, hp: 100, maxHp: 100, facing: 'left',
        isAttacking: false, isBlocking: false, isJumping: false,
        jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
      },
      gameStarted: true,
      winner: null,
      round: 1,
      timer: 90
    };

    startGameLoop();
    startGameTimer();
    broadcastGameState();
  });

  // Manejo de desconexión
  socket.on("disconnect", () => {
    console.log(`[${new Date().toISOString()}] User disconnected: ${socket.id}`);

    if (socket.id === gameState.player1) {
      gameState.player1 = null;
      gameState.player1Keys = {};
      console.log("Player 1 disconnected - slot freed");
    } else if (socket.id === gameState.player2) {
      gameState.player2 = null;
      gameState.player2Keys = {};
      console.log("Player 2 disconnected - slot freed");
    }

    if (gameState.game.gameStarted) {
      gameState.game.gameStarted = false;
      if (gameLoopInterval) clearInterval(gameLoopInterval);
      if (gameTimer) clearInterval(gameTimer);
      console.log("Game paused due to player disconnect");
    }

    broadcastPlayersUpdate();
    broadcastGameState();
  });

  // Manejo de errores
  socket.on("error", (error) => {
    console.error(`Socket error from ${socket.id}:`, error);
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
  console.log(`🔗 HTTP: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
});

// Manejo de errores global
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});