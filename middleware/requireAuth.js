// middleware/requireAuth.js
const jwt = require('jsonwebtoken');

function requireAuth(role = null) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (role && decoded.role !== role) {
        return res.status(403).json({ message: 'Acceso no autorizado' });
      }
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(403).json({ message: 'Token inválido' });
    }
  };
}

module.exports = requireAuth;
