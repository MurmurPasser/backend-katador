// index.js (o tu archivo principal del servidor)

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🔧 Solución aquí: Habilita confianza en el proxy (Railway, Vercel, etc.)
app.set('trust proxy', 1);

// Database configuration for Railway MySQL
const dbConfig = {
    host: process.env.MYSQLHOST || 'localhost',
    port: process.env.MYSQLPORT || 3306,
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || '',
    database: process.env.MYSQLDATABASE || 'railway',
    connectTimeout: 60000,
    acquireTimeout: 60000,
    timeout: 60000,
};
const mongoose = require('mongoose');

// Conexión a MongoDB en Railway
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Conectado a MongoDB en Railway'))
.catch(err => console.error('❌ Error conectando MongoDB:', err));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(cors({
    origin: [
        'https://elkatador.com',
        'https://www.elkatador.com',
        /^https:\/\/.*\.hostinger\..*$/,
        'http://localhost:3000',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'Demasiadas solicitudes, intenta de nuevo más tarde',
        code: 'RATE_LIMIT_EXCEEDED'
    }
});

app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'Katador KPS Backend',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: 'MySQL'
    });
});

// Home para prueba
app.get('/', (req, res) => {
    res.json({
        message: "🚀 Backend Katador KPS funcionando ✅",
        endpoints: {
            health: '/health',
            kps_register: 'POST /api/kps/register',
            login: 'POST /api/auth/login',
            verify: 'GET /auth/me'
        }
    });
});

// KPS Registration Endpoint
app.post('/api/kps/register', async (req, res) => {
    let connection;
    
    try {
        const { usuario, clave, agencia_id } = req.body;
        
        // Input validation
        if (!usuario || !clave) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y clave son requeridos',
                code: 'MISSING_CREDENTIALS'
            });
        }
        
        if (usuario.length < 3 || usuario.length > 50) {
            return res.status(400).json({
                success: false,
                error: 'Usuario debe tener entre 3 y 50 caracteres',
                code: 'INVALID_USERNAME'
            });
        }
        
        if (clave.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Contraseña debe tener al menos 6 caracteres',
                code: 'WEAK_PASSWORD'
            });
        }
        
        // Create database connection
        connection = await mysql.createConnection(dbConfig);
        
        // Hash password using bcrypt
        const saltRounds = 12;
        const claveHash = await bcrypt.hash(clave, saltRounds);
        
        let result;
        
        if (agencia_id) {
            // Update existing approved agency
            const [updateResult] = await connection.execute(`
                UPDATE kps_usuarios_agencia 
                SET usuario = ?, clave_hash = ?, fecha_aprobacion = NOW()
                WHERE id = ? AND es_kps = 1 AND estado_kps = 'aprobado'
            `, [usuario, claveHash, agencia_id]);
            
            if (updateResult.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Agencia no encontrada o no está aprobada',
                    code: 'AGENCY_NOT_FOUND'
                });
            }
            
            result = { insertId: agencia_id, affectedRows: updateResult.affectedRows };
            
        } else {
            // Check if username already exists
            const [existingUsers] = await connection.execute(
                'SELECT id FROM kps_usuarios_agencia WHERE usuario = ? AND es_kps = 1',
                [usuario]
            );
            
            if (existingUsers.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: 'El usuario ya existe',
                    code: 'USERNAME_EXISTS'
                });
            }
            
            // Create new KPS user record
            const [insertResult] = await connection.execute(`
                INSERT INTO kps_usuarios_agencia 
                (usuario, clave_hash, es_kps, estado_kps, fecha_solicitud, fecha_aprobacion)
                VALUES (?, ?, 1, 'aprobado', NOW(), NOW())
            `, [usuario, claveHash]);
            
            result = insertResult;
        }
        
        console.log(`[KPS-REGISTER] Success - Usuario: ${usuario}, ID: ${result.insertId || agencia_id}`);
        
        res.status(201).json({
            success: true,
            message: 'Usuario KPS registrado exitosamente',
            data: {
                usuario: usuario,
                id: result.insertId || agencia_id,
                created_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('[KPS-REGISTER] Error:', error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                error: 'El usuario ya existe en el sistema',
                code: 'DUPLICATE_USER'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            code: 'INTERNAL_SERVER_ERROR'
        });
        
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

// Login endpoint for KPS users
//app.post('/api/auth/login', async (req, res) => {
   // let connection;
    
    //try {
        //const { usuario, clave } = req.body;
        
        //if (!usuario || !clave) {
            //return res.status(400).json({
                //success: false,
                //error: 'Usuario y contraseña requeridos',
                //code: 'MISSING_CREDENTIALS'
            //});
        //}
        
        connection = await mysql.createConnection(dbConfig);
        
        // Get user from KPS table
        const [users] = await connection.execute(`
            SELECT id, usuario, clave_hash, nombre_agencia, email_contacto, estado_kps
            FROM kps_usuarios_agencia 
            WHERE usuario = ? AND es_kps = 1 AND estado_kps = 'aprobado'
        `, [usuario]);
        
        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        const user = users[0];
        
        // Verify password with bcrypt
        const isValidPassword = await bcrypt.compare(clave, user.clave_hash);
        
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                usuario: user.usuario,
                nombre_agencia: user.nombre_agencia,
                email: user.email_contacto,
                type: 'kps'
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`[LOGIN] Success - Usuario: ${usuario}, ID: ${user.id}`);
        
        res.json({
            success: true,
            message: 'Login exitoso',
            token: token,
            user: {
                id: user.id,
                usuario: user.usuario,
                nombre_agencia: user.nombre_agencia,
                email: user.email_contacto,
                type: 'kps'
            }
        });
        
    } catch (error) {
        console.error('[LOGIN] Error:', error);
        
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            code: 'INTERNAL_SERVER_ERROR'
        });
        
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

// Verify JWT token endpoint
app.get('/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Token no proporcionado',
                code: 'NO_TOKEN'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        
        res.json({
            success: true,
            user: decoded
        });
        
    } catch (error) {
        console.error('[AUTH-ME] Error:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(41).json({
                success: false,
                error: 'Token expirado',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Token inválido',
                code: 'INVALID_TOKEN'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Error de autenticación',
            code: 'AUTH_ERROR'
        });
    }
});

// Legacy routes (mantener compatibilidad)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/credits', require('./routes/credits'));

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint no encontrado',
        code: 'NOT_FOUND'
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('[ERROR]', error);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        code: 'INTERNAL_SERVER_ERROR'
    });
});

// Lanzar servidor
app.listen(PORT, () => {
    console.log(`🚀 Katador KPS Backend running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 KPS Register: POST http://localhost:${PORT}/api/kps/register`);
    console.log(`🔑 Login: POST http://localhost:${PORT}/api/auth/login`);
    console.log(`🔍 Auth Check: GET http://localhost:${PORT}/auth/me`);
});

module.exports = app;
