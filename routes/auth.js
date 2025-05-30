// routes/auth.js (Backend Railway - Node.js)

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Tu modelo de usuario de Mongoose
const authMiddleware = require('../middleware/authMiddleware'); // Tu middleware de autenticación
const mysql = require('mysql2/promise'); // Para conectar a MySQL

// --- Configuración de la conexión a MySQL (la BD en Railway que tiene usuarios y planes_usuario) ---
// Usamos los nombres de variable de entorno estándar que Railway proporciona para su servicio MySQL
const poolMySqlRailway = mysql.createPool({
  host: process.env.MYSQLHOST,         // Variable estándar de Railway para el host de MySQL
  user: process.env.MYSQLUSER,         // Variable estándar de Railway para el usuario de MySQL
  password: process.env.MYSQLPASSWORD,   // Variable estándar de Railway para la contraseña de MySQL
  database: process.env.MYSQLDATABASE,   // Variable estándar de Railway para el nombre de la BD
  port: process.env.MYSQLPORT,         // Variable estándar de Railway para el puerto de MySQL
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Opcional: añadir un pequeño timeout para la conexión inicial si es necesario
  // connectTimeout: 10000 // 10 segundos
});

// Pequeño test de conexión al iniciar (opcional, para depuración en logs de Railway)
(async () => {
  let testConn;
  try {
    testConn = await poolMySqlRailway.getConnection();
    console.log("Conexión a MySQL de Railway (para planes) establecida y probada con ping.");
    await testConn.ping();
  } catch (err) {
    console.error("FALLO INICIAL al conectar/ping a MySQL de Railway (para planes):", err.message);
    if (err.code) console.error("Código de error MySQL:", err.code);
  } finally {
    if (testConn) testConn.release();
  }
})();


// --- RUTA DE REGISTRO ---
router.post('/register', async (req, res) => {
  const { role, alias, phone, email, password } = req.body;
  if (!role || !alias || !email || !password) {
    return res.status(400).json({ message: 'Faltan campos requeridos (role, alias, email, password).' });
  }

  let connectionMySql = null;
  let savedUserMongo = null; // Para poder deshacer si falla MySQL

  try {
    // 1. Verificar si el email ya existe en MongoDB
    const existingUserMongo = await User.findOne({ email });
    if (existingUserMongo) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado en el sistema principal.' });
    }

    // 2. Crear usuario en MongoDB
    const userMongo = new User({
      role,
      alias,
      phone: (role === 'modelo' && phone && phone.trim() !== '') ? phone.trim() : undefined,
      email,
      password
    });
    savedUserMongo = await userMongo.save();

    // 3. Crear usuario y plan en MySQL (Railway)
    connectionMySql = await poolMySqlRailway.getConnection();
    await connectionMySql.beginTransaction();

    // 3a. Insertar en tabla `usuarios` (MySQL en Railway)
    const [resultInsertUserMySQL] = await connectionMySql.execute(
      'INSERT INTO usuarios (mongodb_id, nombre_usuario, tipo_usuario, correo, fecha_registro, estado) VALUES (?, ?, ?, ?, NOW(), ?)',
      [savedUserMongo._id.toString(), alias, role, email, 'activo'] // Añadido estado 'activo'
    );
    const mySqlUserId = resultInsertUserMySQL.insertId;

    // 3b. Insertar plan 'gratis' por defecto en `planes_usuario` (MySQL en Railway)
    const defaultPlan = 'gratis';
    const fechaInicio = new Date();
    // MySQL TIMESTAMP/DATETIME espera 'YYYY-MM-DD HH:MM:SS'
    const fechaInicioSQL = fechaInicio.toISOString().slice(0, 19).replace('T', ' ');
    const fechaExpiracion = new Date(new Date().setDate(fechaInicio.getDate() + 30));
    const fechaExpiracionSQL = fechaExpiracion.toISOString().slice(0, 19).replace('T', ' ');

    await connectionMySql.execute(
      'INSERT INTO planes_usuario (usuario_id, nombre_plan, fecha_inicio, fecha_expiracion) VALUES (?, ?, ?, ?)',
      [mySqlUserId, defaultPlan, fechaInicioSQL, fechaExpiracionSQL]
    );

    await connectionMySql.commit();

    res.status(201).json({
      message: 'Usuario registrado exitosamente. Ahora puedes iniciar sesión.',
      userIdMongo: savedUserMongo._id.toString()
    });

  } catch (error) {
    if (connectionMySql) {
        try { await connectionMySql.rollback(); } catch (rbError) { console.error("Error en rollback de MySQL:", rbError); }
    }
    console.error('Error durante el registro:', error);
    
    if (savedUserMongo && error.sqlMessage) { // Si el error es de MySQL y el usuario se creó en Mongo
      try {
        await User.findByIdAndDelete(savedUserMongo._id); // Deshacer registro en MongoDB
        console.log(`Usuario ${savedUserMongo._id} eliminado de MongoDB debido a fallo en MySQL.`);
      } catch (deleteError) {
        console.error(`Error al intentar eliminar usuario ${savedUserMongo._id} de MongoDB tras fallo en MySQL:`, deleteError);
      }
    }

    if (error.name === 'ValidationError' && error.errors) {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    if (error.code === 11000) { // Error de duplicado (email) en MongoDB
      return res.status(400).json({ message: 'El correo electrónico ya está registrado (MongoDB).' });
    }
    // Errores de MySQL
    if (error.code === 'ER_DUP_ENTRY') {
        if (error.sqlMessage && error.sqlMessage.toLowerCase().includes('correo')) {
             return res.status(400).json({ message: 'El correo electrónico ya está registrado (Sistema secundario).' });
        }
        if (error.sqlMessage && error.sqlMessage.toLowerCase().includes('mongodb_id')) {
            return res.status(400).json({ message: 'El identificador de usuario ya existe (Sistema secundario).' });
        }
        return res.status(400).json({ message: 'Conflicto de datos duplicados (Sistema secundario).' });
    }
    res.status(500).json({ message: 'Error interno del servidor durante el registro.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});


// --- RUTA DE LOGIN ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Por favor, ingrese correo electrónico y contraseña.' });
  }
  try {
    const user = await User.findOne({ email }); // Modelo Mongoose
    if (!user) {
        return res.status(401).json({ message: 'Credenciales inválidas.' });
    }
    if (!(await user.matchPassword(password))) {
        return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    // Verificar estado del usuario en MySQL de Railway
    let connectionMySql = null;
    try {
        connectionMySql = await poolMySqlRailway.getConnection();
        const [mysqlUserRows] = await connectionMySql.execute(
            'SELECT estado FROM usuarios WHERE mongodb_id = ? LIMIT 1',
            [user._id.toString()]
        );
        if (mysqlUserRows.length === 0 || mysqlUserRows[0].estado !== 'activo') {
            console.warn(`Intento de login para usuario ${email} no activo o no encontrado en MySQL Railway. Estado: ${mysqlUserRows[0]?.estado}`);
            return res.status(403).json({ message: 'Tu cuenta no está activa o ha sido suspendida.' });
        }
    } catch (mysqlError) {
        console.error('Error al verificar estado del usuario en MySQL durante login:', mysqlError);
        return res.status(500).json({ message: 'Error interno al verificar el estado de la cuenta.' });
    } finally {
        if (connectionMySql) connectionMySql.release();
    }


    const tokenPayload = {
      id: user._id.toString(),
      role: user.role,
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
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor durante el login.' });
  }
});


// --- RUTA /api/auth/me (para obtener datos del usuario autenticado + su plan) ---
router.get('/me', authMiddleware, async (req, res) => {
  let connectionMySql = null;
  try {
    const userMongoId = req.user.id; // ID de MongoDB del token
    const userMongo = await User.findById(userMongoId).select('-password'); // Excluye la contraseña
    if (!userMongo) {
      return res.status(404).json({ message: 'Usuario principal no encontrado.' });
    }

    let planInfo = { nombre_plan: 'gratis', fecha_expiracion: null, message: "Plan por defecto (gratis)." };

    connectionMySql = await poolMySqlRailway.getConnection();
    const [mysqlUserRows] = await connectionMySql.execute(
      'SELECT id, tipo_usuario, estado FROM usuarios WHERE mongodb_id = ? LIMIT 1',
      [userMongoId.toString()]
    );

    if (mysqlUserRows.length > 0) {
      const mySqlUserId = mysqlUserRows[0].id;
      const mysqlUserEstado = mysqlUserRows[0].estado;

      if (mysqlUserEstado !== 'activo') {
        // El usuario está inactivo o baneado en MySQL, podría ser una razón para invalidar la sesión
        // o devolver información limitada. Por ahora, le daremos plan gratis y un mensaje.
        console.warn(`Usuario ${userMongo.email} (MongoDB ID: ${userMongoId}) tiene estado '${mysqlUserEstado}' en MySQL Railway.`);
        planInfo.message = `El estado de tu cuenta es '${mysqlUserEstado}'. Se aplican beneficios del plan gratuito.`;
        // Podrías aquí forzar la invalidación del token si 'baneado'
        // if (mysqlUserEstado === 'baneado') {
        //    return res.status(403).json({ message: "Tu cuenta ha sido suspendida."})
        // }
      } else {
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
        role: userMongo.role,
        phone: userMongo.phone || '',
        plan_info: planInfo
      }
    });

  } catch (error) {
    console.error('Error en /api/auth/me:', error);
    res.status(500).json({ message: 'Error interno del servidor al obtener datos del usuario.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});

// --- RUTA PARA ACTUALIZAR PERFIL (alias, phone en MongoDB) ---
router.patch('/users/me/profile', authMiddleware, async (req, res) => {
    const { alias, phone } = req.body;
    const userId = req.user.id; // ID de MongoDB del usuario autenticado

    if (!alias && (phone === undefined || phone === null) ) { // Permitir enviar phone vacío para borrarlo
        return res.status(400).json({ success: false, message: 'No hay datos para actualizar.' });
    }
    
    let connectionMySql = null;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado en MongoDB.' });
        }

        const mongoUpdateOps = {};
        const mySqlUpdateOps = {};
        const mySqlUpdateValues = [];

        if (alias && alias.trim() !== user.alias) {
            user.alias = alias.trim();
            mongoUpdateOps.alias = user.alias;
            mySqlUpdateOps.nombre_usuario = user.alias;
        }
        if (phone !== undefined) { // Si se envía el campo 'phone'
            const trimmedPhone = phone.trim();
            if (trimmedPhone === '' && user.phone) { // Si se envía vacío y antes había un teléfono
                user.phone = undefined; // Para que Mongoose lo elimine
                mongoUpdateOps.phone = null; // O ''
                // mySqlUpdateOps.telefono_contacto = null; // Si tienes telefono en tabla usuarios MySQL
            } else if (trimmedPhone !== '' && trimmedPhone !== user.phone) {
                user.phone = trimmedPhone;
                mongoUpdateOps.phone = user.phone;
                // mySqlUpdateOps.telefono_contacto = user.phone; // Si tienes telefono en tabla usuarios MySQL
            }
        }
        
        if (Object.keys(mongoUpdateOps).length === 0) {
             return res.status(200).json({ success: true, message: 'No hubo cambios para aplicar.', user: {
                _id: user._id.toString(), alias: user.alias, email: user.email, role: user.role, phone: user.phone || ''
             }});
        }

        const updatedUserMongo = await user.save();

        // Actualizar en MySQL de Railway si hay cambios relevantes (ej. nombre_usuario)
        if (Object.keys(mySqlUpdateOps).length > 0) {
            connectionMySql = await poolMySqlRailway.getConnection();
            const setClauses = Object.keys(mySqlUpdateOps).map(key => `${key} = ?`).join(', ');
            const valuesForMySql = [...Object.values(mySqlUpdateOps), updatedUserMongo._id.toString()];
            
            await connectionMySql.execute(
               `UPDATE usuarios SET ${setClauses} WHERE mongodb_id = ?`,
               valuesForMySql
            );
            console.log(`Perfil de usuario ${updatedUserMongo._id} actualizado también en MySQL Railway.`);
        }

        res.status(200).json({
            success: true,
            message: 'Perfil actualizado con éxito.',
            user: {
                _id: updatedUserMongo._id.toString(),
                alias: updatedUserMongo.alias,
                email: updatedUserMongo.email,
                role: updatedUserMongo.role,
                phone: updatedUserMongo.phone || ''
            }
        });
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ success: false, message: messages.join(', ') });
        }
        res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar el perfil.' });
    } finally {
        if (connectionMySql) connectionMySql.release();
    }
});


// --- RUTA PARA CAMBIAR CONTRASEÑA (en MongoDB) ---
router.post('/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: "Todos los campos son requeridos." });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: "La nueva contraseña y la confirmación no coinciden." });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: "La nueva contraseña debe tener al menos 6 caracteres." });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado." });
        }

        const isMatch = await user.matchPassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "La contraseña actual es incorrecta." });
        }

        user.password = newPassword;
        await user.save();

        // Opcional: Actualizar `password_hash` en la tabla `usuarios` de MySQL (Railway)
        // Necesitarías hashear `newPassword` de la misma forma que lo haces para Mongoose
        // (o si usas una función de hash de MySQL, aplicarla aquí).
        // let connectionMySql = null;
        // try {
        //    connectionMySql = await poolMySqlRailway.getConnection();
        //    const newPasswordHashMySql = await bcrypt.hash(newPassword, 10); // Asumiendo bcrypt para consistencia
        //    await connectionMySql.execute(
        //      'UPDATE usuarios SET password_hash = ? WHERE mongodb_id = ?',
        //      [newPasswordHashMySql, userId.toString()]
        //    );
        // } catch (mysqlError) {
        //   console.error('Error al actualizar password_hash en MySQL Railway:', mysqlError);
        //   // No fallar la operación principal si MongoDB tuvo éxito, pero loguear.
        // } finally {
        //   if (connectionMySql) connectionMySql.release();
        // }

        res.status(200).json({ success: true, message: "Contraseña actualizada con éxito." });

    } catch (error) {
        console.error('Error al cambiar contraseña en MongoDB:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al cambiar la contraseña.' });
    }
});

module.exports = router;
