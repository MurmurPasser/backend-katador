const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 8080;

require('dotenv').config();

app.use(cors({
  origin: ['https://elkatador.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/credits', require('./routes/credits'));
app.use('/api/kps', require('./routes/api_kps_register'));

app.get('/', (req, res) => res.send("Backend KPS funcionando ✅"));
app.listen(port, () => console.log(`🚀 Servidor en puerto ${port}`));
