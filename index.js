const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRoutes);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});