// Node.js endpoint for KPS user registration with bcrypt hashing
// POST /api/kps/register
// Compatible with Railway deployment

const express = require('express');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const cors = require('cors');

const router = express.Router();

// Database configuration - use Railway environment variables
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

// Enable CORS for Hostinger requests
router.use(cors({
    origin: [
        'https://elkatador.com',
        'https://www.elkatador.com',
        /^https:\/\/.*\.hostinger\..*$/,
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

/**
 * POST /api/kps/register
 * Register KPS user with bcrypt password hashing
 * 
 * Body: {
 *   usuario: string,
 *   clave: string,
 *   agencia_id?: number (optional, for updating existing record)
 * }
 */
router.post('/register', async (req, res) => {
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
        
        // Hash password using bcrypt (same as login endpoint)
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
            
            // Create new KPS user record (for standalone registration)
            const [insertResult] = await connection.execute(`
                INSERT INTO kps_usuarios_agencia 
                (usuario, clave_hash, es_kps, estado_kps, fecha_solicitud, fecha_aprobacion)
                VALUES (?, ?, 1, 'aprobado', NOW(), NOW())
            `, [usuario, claveHash]);
            
            result = insertResult;
        }
        
        // Log successful registration for audit
        console.log(`[KPS-REGISTER] Success - Usuario: ${usuario}, ID: ${result.insertId || agencia_id}, Timestamp: ${new Date().toISOString()}`);
        
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
        console.error('[KPS-REGISTER] Error:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            sqlState: error.sqlState,
            timestamp: new Date().toISOString()
        });
        
        // Handle specific MySQL errors
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                error: 'El usuario ya existe en el sistema',
                code: 'DUPLICATE_USER'
            });
        }
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(503).json({
                success: false,
                error: 'Error de conexión a la base de datos',
                code: 'DATABASE_CONNECTION_ERROR'
            });
        }
        
        // Generic error response
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            code: 'INTERNAL_SERVER_ERROR',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

/**
 * GET /api/kps/register/health
 * Health check endpoint
 */
router.get('/register/health', (req, res) => {
    res.json({
        success: true,
        service: 'KPS Registration API',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

module.exports = router;