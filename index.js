import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';

dotenv.config();

const app = express();

// Activar CORS para todas las rutas
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api', authRoutes);

// Conexión Mongo & arranque
const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  app.listen(PORT);
})
.catch(err => console.error('MongoDB error:', err));
