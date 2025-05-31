const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Middleware global
app.use(cors());
app.use(express.json());

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB conectado');
}).catch(err => {
  console.error('❌ Error al conectar a MongoDB:', err.message);
});

// Rutas
const authRoutes = require('./routes/auth');
const creditRoutes = require('./routes/credits'); // NUEVA RUTA

app.use('/api/auth', authRoutes);
app.use('/api/credits', creditRoutes); // NUEVA RUTA

// Ruta base de prueba
app.get('/', (req, res) => {
  res.send('Backend Katador funcionando ✅');
});

// Inicializar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor backend corriendo en puerto ${port}`);
});
