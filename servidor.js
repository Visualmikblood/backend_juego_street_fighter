// servidor.js
import { Server } from "socket.io";

const io = new Server(3001, {
  cors: {
    origin: "*",
  },
});

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

const broadcastPlayersUpdate = () => {
  const connectedPlayers =
    (gameState.player1 ? 1 : 0) + (gameState.player2 ? 1 : 0);
  io.emit("playersUpdate", {
    player1Connected: !!gameState.player1,
    player2Connected: !!gameState.player2,
    total: connectedPlayers,
  });
};

const broadcastGameState = () => {
  io.emit("gameStateUpdate", gameState.game);
};

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

// Game loop del servidor
const gameLoop = () => {
  if (!gameState.game.gameStarted || gameState.game.winner) return;

  const newGame = { ...gameState.game };

  // Player 1 controls (WASD + FGH)
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

  // Player 1 attack
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

  // Player 1 special
  if (p1Keys['h'] && newGame.player1.special >= 50) {
    newGame.player1.special -= 50;
    const result = performAttack(newGame.player1, newGame.player2, 'special');
    newGame.player2.hp = result.hp;
    newGame.player1.combo += 1;
  }

  // Player 2 controls (Arrow keys + 123)
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

  // Player 2 attack
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

  // Player 2 special
  if (p2Keys['3'] && newGame.player2.special >= 50) {
    newGame.player2.special -= 50;
    const result = performAttack(newGame.player2, newGame.player1, 'special');
    newGame.player1.hp = result.hp;
    newGame.player2.combo += 1;
  }

  // Physics for both players
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

  // Regenerate special meter
  if (newGame.player1.special < 100) newGame.player1.special += 0.5;
  if (newGame.player2.special < 100) newGame.player2.special += 0.5;

  // Reset combos after inactivity
  const now = Date.now();
  if (now - newGame.player1.lastAttackTime > 2000) newGame.player1.combo = 0;
  if (now - newGame.player2.lastAttackTime > 2000) newGame.player2.combo = 0;

  // Check for winners
  if (newGame.player1.hp <= 0) newGame.winner = 'Player 2';
  else if (newGame.player2.hp <= 0) newGame.winner = 'Player 1';

  gameState.game = newGame;
  broadcastGameState();
};

// Timer countdown
let gameTimer;
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

// Game loop interval
let gameLoopInterval;
const startGameLoop = () => {
  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(gameLoop, 16);
};

io.on("connection", (socket) => {
  console.log("User connected: " + socket.id);

  // Asignar jugador
  if (!gameState.player1) {
    gameState.player1 = socket.id;
    socket.emit("assignPlayer", "player1");
    console.log(`Player 1 assigned: ${socket.id}`);
  } else if (!gameState.player2) {
    gameState.player2 = socket.id;
    socket.emit("assignPlayer", "player2");
    console.log(`Player 2 assigned: ${socket.id}`);
  } else {
    socket.emit("assignPlayer", "spectator");
    console.log(`Spectator assigned: ${socket.id}`);
  }

  // Enviar estado actual
  broadcastPlayersUpdate();
  socket.emit("gameStateUpdate", gameState.game);

  // Manejar acciones del jugador
  socket.on("playerAction", (data) => {
    if (socket.id === gameState.player1) {
      gameState.player1Keys = data.keys;
    } else if (socket.id === gameState.player2) {
      gameState.player2Keys = data.keys;
    }
  });

  // Manejar inicio de juego
  socket.on("startGame", () => {
    console.log("Game started by:", socket.id);
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

  // Manejar desconexión
  socket.on("disconnect", () => {
    console.log("User disconnected: " + socket.id);

    if (gameState.player1 === socket.id) {
      gameState.player1 = null;
      gameState.player1Keys = {};
      console.log("Player 1 disconnected");
    } else if (gameState.player2 === socket.id) {
      gameState.player2 = null;
      gameState.player2Keys = {};
      console.log("Player 2 disconnected");
    }

    // Pausar juego si alguien se desconecta
    if (gameState.game.gameStarted) {
      gameState.game.gameStarted = false;
      clearInterval(gameLoopInterval);
      clearInterval(gameTimer);
    }

    broadcastPlayersUpdate();
    broadcastGameState();
  });
});

console.log("Socket.IO server running on port 3001");