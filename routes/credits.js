
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const mysql = require('mysql2/promise');

// Crear un pool de conexión (puedes usar el que tienes en index.js y pasarlo por req.mysql si prefieres)
const poolMySqlRailway = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

router.post('/consume', authMiddleware, async (req, res) => {
    const userMongoId = req.user.id;
    const { creditos_a_consumir, descripcion_transaccion } = req.body;

    if (!creditos_a_consumir || typeof creditos_a_consumir !== 'number' || creditos_a_consumir <= 0) {
        return res.status(400).json({ success: false, message: 'Cantidad de créditos a consumir inválida.' });
    }

    let connectionMySql = null;
    try {
        connectionMySql = await poolMySqlRailway.getConnection();
        await connectionMySql.beginTransaction();

        const [mysqlUserRows] = await connectionMySql.execute(
            'SELECT id FROM usuarios WHERE mongodb_id = ? LIMIT 1',
            [userMongoId]
        );

        if (mysqlUserRows.length === 0) {
            await connectionMySql.rollback();
            return res.status(404).json({ success: false, message: 'Usuario no encontrado en el sistema de créditos.' });
        }
        const mySqlUserId = mysqlUserRows[0].id;

        const [creditosRows] = await connectionMySql.execute(
            'SELECT creditos_actuales FROM creditos_usuario WHERE usuario_id = ? FOR UPDATE',
            [mySqlUserId]
        );

        if (creditosRows.length === 0) {
            await connectionMySql.rollback();
            return res.status(404).json({ success: false, message: 'Registro de créditos del usuario no encontrado.' });
        }

        const creditosActuales = creditosRows[0].creditos_actuales;

        if (creditosActuales < creditos_a_consumir) {
            await connectionMySql.rollback();
            return res.status(400).json({
                success: false,
                message: `Créditos insuficientes. Tienes ${creditosActuales}, necesitas ${creditos_a_consumir}.`,
                current_credits: creditosActuales
            });
        }

        const nuevosCreditos = creditosActuales - creditos_a_consumir;
        await connectionMySql.execute(
            'UPDATE creditos_usuario SET creditos_actuales = ? WHERE usuario_id = ?',
            [nuevosCreditos, mySqlUserId]
        );

        await connectionMySql.commit();
        res.status(200).json({
            success: true,
            message: 'Créditos consumidos exitosamente.',
            creditos_restantes: nuevosCreditos
        });

    } catch (error) {
        if (connectionMySql) {
            try { await connectionMySql.rollback(); } catch (rbError) { console.error("Error en rollback de MySQL (consumo créditos):", rbError); }
        }
        console.error('Error al consumir créditos:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al procesar el consumo de créditos.' });
    } finally {
        if (connectionMySql) connectionMySql.release();
    }
});

module.exports = router;
