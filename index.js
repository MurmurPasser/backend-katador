const express = require('express');
const app = express();
const authRoutes = require('./routes/auth');
const protectedRoutes = require('./routes/protected');
require('dotenv').config();

app.use(express.json());
app.use('/api', authRoutes);
app.use('/api', protectedRoutes);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
