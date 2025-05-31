const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error("❌ MongoDB error:", err.message));

app.use('/api/auth', require('./routes/auth'));

app.get('/', (req, res) => res.send("Backend funcionando ✅"));

app.listen(port, () => console.log(`🚀 Servidor backend corriendo en puerto ${port}`));
