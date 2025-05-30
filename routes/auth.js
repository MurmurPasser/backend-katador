// routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Modelo Mongoose
const authMiddleware = require('../middleware/authMiddleware');
const mysql = require('mysql2/promise');

// Pool de Conexión a MySQL en Railway (donde están usuarios y planes_usuario)
const poolMySqlRailway = mysql.createPool({
  host: process.env.MYSQL_HOST_RAILWAY, // ej. interchange.proxy.rlwy.net
  user: process.env.MYSQL_USER_RAILWAY,
  password: process.env.MYSQL_PASSWORD_RAILWAY,
  database: process.env.MYSQL_DB_RAILWAY, // ej. railway
  port: process.env.MYSQL_PORT_RAILWAY, // ej. 52801
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// --- RUTA DE REGISTRO ---
router.post('/register', async (req, res) => {
  const { role, alias, phone, email, password } = req.body;
  if (!role || !alias || !email || !password) {
    return res.status(400).json({ message: 'Faltan campos requeridos (role, alias, email, password).' });
  }

  let connectionMySql = null;

  try {
    // 1. Verificar si el email ya existe en MongoDB
    const existingUserMongo = await User.findOne({ email });
    if (existingUserMongo) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
    }

    // 2. Crear usuario en MongoDB
    const userMongo = new User({
      role, // tipo_usuario en MongoDB
      alias,
      phone: (role === 'modelo' && phone && phone.trim() !== '') ? phone.trim() : undefined,
      email,
      password
    });
    const savedUserMongo = await userMongo.save();

    // 3. Crear usuario y plan en MySQL (Railway)
    connectionMySql = await poolMySqlRailway.getConnection();
    await connectionMySql.beginTransaction();

    // 3a. Insertar en tabla `usuarios` (MySQL)
    // Usamos el _id de MongoDB como identificador único en una nueva columna mongodb_id
    // y el `role` de MongoDB como `tipo_usuario` en MySQL.
    const [resultInsertUserMySQL] = await connectionMySql.execute(
      'INSERT INTO usuarios (mongodb_id, nombre_usuario, tipo_usuario, correo, fecha_registro) VALUES (?, ?, ?, ?, NOW())',
      [savedUserMongo._id.toString(), alias, role, email]
    );
    const mySqlUserId = resultInsertUserMySQL.insertId; // ID autoincremental de la tabla `usuarios` MySQL

    // 3b. Insertar plan 'gratis' por defecto en `planes_usuario` (MySQL)
    const defaultPlan = 'gratis';
    const fechaInicio = new Date();
    const fechaExpiracion = new Date(new Date().setDate(fechaInicio.getDate() + 30)); // Gratis por 30 días

    await connectionMySql.execute(
      'INSERT INTO planes_usuario (usuario_id, nombre_plan, fecha_inicio, fecha_expiracion) VALUES (?, ?, ?, ?)',
      [mySqlUserId, defaultPlan, fechaInicio, fechaExpiracion]
    );

    await connectionMySql.commit();

    res.status(201).json({
      message: 'Usuario registrado exitosamente en ambos sistemas. Ahora puedes iniciar sesión.',
      userIdMongo: savedUserMongo._id
    });

  } catch (error) {
    if (connectionMySql) await connectionMySql.rollback();
    console.error('Error durante el registro:', error);
    
    // Si el error es de MongoDB y el usuario ya se había creado allí pero falló MySQL, considerar deshacer
    // if (savedUserMongo && error.message.includes('MySQL')) {
    //   await User.findByIdAndDelete(savedUserMongo._id);
    // }

    if (error.name === 'ValidationError' && error.errors) { // Error de validación de Mongoose
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    if (error.code === 11000) { // Error de duplicado (email) en MongoDB
      return res.status(400).json({ message: 'El correo electrónico ya está registrado (MongoDB).' });
    }
    if (error.code === 'ER_DUP_ENTRY' && error.sqlMessage && error.sqlMessage.includes('correo')) { // Error de duplicado de email en MySQL
        return res.status(400).json({ message: 'El correo electrónico ya está registrado (MySQL).' });
    }
    if (error.code === 'ER_DUP_ENTRY' && error.sqlMessage && error.sqlMessage.includes('mongodb_id')) {
        return res.status(400).json({ message: 'El identificador de usuario ya existe (MySQL).' });
    }
    res.status(500).json({ message: 'Error interno del servidor durante el registro.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});


// --- RUTA DE LOGIN ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  // ... (tu lógica de login actual que verifica contra MongoDB está bien) ...
  // Asegúrate que la respuesta incluya el _id de MongoDB:
  // user: { _id: user._id, role: user.role, alias: user.alias, email: user.email, phone: user.phone || '' }
  // Esto ya lo tienes bien.
  try {
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      const tokenPayload = {
        id: user._id, // _id de MongoDB
        role: user.role, // tipo_usuario de MongoDB
        email: user.email,
        alias: user.alias
      };
      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.status(200).json({
        message: 'Login exitoso',
        token,
        user: {
          _id: user._id.toString(),
          role: user.role,
          alias: user.alias,
          email: user.email,
          phone: user.phone || ''
        }
      });
    } else {
      res.status(401).json({ message: 'Credenciales inválidas.' });
    }
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});


// --- RUTA /api/auth/me MODIFICADA ---
router.get('/me', authMiddleware, async (req, res) => {
  let connectionMySql = null;
  try {
    const userMongoId = req.user.id; // Este es el _id de MongoDB del token
    const userMongo = await User.findById(userMongoId).select('-password');
    if (!userMongo) {
      return res.status(404).json({ message: 'Usuario principal no encontrado.' });
    }

    let planInfo = { nombre_plan: 'gratis', fecha_expiracion: null, message: "Plan por defecto (gratis)." }; // Fallback

    connectionMySql = await poolMySqlRailway.getConnection();
    // 1. Buscar el `id` de la tabla `usuarios` (MySQL) usando el `mongodb_id`
    const [mysqlUserRows] = await connectionMySql.execute(
      'SELECT id, tipo_usuario FROM usuarios WHERE mongodb_id = ? LIMIT 1', // tipo_usuario es el 'role' de MongoDB
      [userMongoId.toString()]
    );

    if (mysqlUserRows.length > 0) {
      const mySqlUserId = mysqlUserRows[0].id;
      const tipoUsuarioMySql = mysqlUserRows[0].tipo_usuario; // Puede ser útil para consistencia

      // 2. Obtener el plan activo de `planes_usuario` (MySQL)
      const [planRows] = await connectionMySql.execute(
        'SELECT nombre_plan, fecha_inicio, fecha_expiracion FROM planes_usuario WHERE usuario_id = ? AND fecha_expiracion >= CURDATE() ORDER BY fecha_expiracion DESC LIMIT 1',
        [mySqlUserId]
      );

      if (planRows.length > 0) {
        planInfo = {
          nombre_plan: planRows[0].nombre_plan,
          fecha_inicio: planRows[0].fecha_inicio,
          fecha_expiracion: planRows[0].fecha_expiracion,
        };
      } else {
         planInfo.message = "No se encontró plan activo o ha expirado. Usando gratis.";
      }
    } else {
      console.warn(`Usuario con MongoDB ID ${userMongoId} no encontrado en tabla 'usuarios' de MySQL en Railway.`);
       planInfo.message = "Perfil de plan no configurado en sistema secundario. Usando gratis.";
    }

    res.json({
      user: {
        _id: userMongo._id.toString(),
        email: userMongo.email,
        alias: userMongo.alias,
        role: userMongo.role, // Rol de MongoDB ('modelo', 'katador', etc.)
        phone: userMongo.phone || '',
        plan_info: planInfo // Información del plan de MySQL (Railway)
      }
    });

  } catch (error) {
    console.error('Error en /api/auth/me:', error);
    res.status(500).json({ message: 'Error interno del servidor al obtener datos del usuario.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});

// ... (tus otras rutas como /users/me/profile y /change-password, que interactúan con MongoDB, están bien) ...
// Asegúrate que las rutas /users/me/profile y /change-password estén definidas aquí también.

module.exports = router;
