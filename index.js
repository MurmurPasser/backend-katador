const express = require('express');
const app = express();
const authRoutes = require('./routes/auth');
require('dotenv').config();

app.use(express.json());
app.use('/api', authRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
