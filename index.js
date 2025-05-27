require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth'); // Contiene las rutas /register, /login, /me
const protectedRoutes = require('./routes/protected');

const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// Cambia esta línea:
// app.use('/api', authRoutes);
// Por esta:
app.use('/api/auth', authRoutes); // <--- CAMBIO AQUÍ

// Si tus protectedRoutes también deben estar bajo /api (y no /api/auth o similar)
// esta línea está bien como está, o puedes ajustarla si es necesario.
// Por ejemplo, si fueran /api/protected/ruta, sería app.use('/api/protected', protectedRoutes);
app.use('/api', protectedRoutes); // Asumiendo que las rutas en protected.js no tienen 'protected'

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({ message: 'Algo salió mal en el servidor!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));