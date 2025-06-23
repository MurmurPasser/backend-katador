const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Middlewares
app.use(cors({
  origin: ['https://elkatador.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json());

// MongoDB conexión
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error("❌ MongoDB error:", err.message));

// Rutas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/credits', require('./routes/credits')); // <--- ⚡ REGISTRO DE LA RUTA DE CRÉDITOS
app.use('/api/kps', require('./routes/kps'));
// Home para prueba
app.get('/', (req, res) => res.send("Backend funcionando ✅"));

// Lanzar servidor
app.listen(port, () => console.log(`🚀 Servidor backend corriendo en puerto ${port}`));
