const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  alias: { type: String, required: true },
  role: { type: String, enum: ['katador','modelo'], required: true },
  phone: { type: String }
});
module.exports = mongoose.model('User', userSchema);