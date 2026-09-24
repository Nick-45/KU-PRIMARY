// src/setupProxy.js
const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mpesaStkPush = require('../netlify/functions/mpesa-stk-push');
const mpesaTestConnection = require('../netlify/functions/mpesa-test-connection');

module.exports = function (app) {
    app.use(express.json());

    app.post('/api/mpesa-stk-push', async (req, res) => {
        try {
            const event = {
                httpMethod: 'POST',
                body: typeof req.body === 'object' ? JSON.stringify(req.body) : req.body
            };
            const result = await mpesaStkPush.handler(event);
            res.status(result.statusCode || 200).json(JSON.parse(result.body || '{}'));
        } catch (err) {
            console.error('Dev proxy mpesa-stk-push error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/api/mpesa-test-connection', async (req, res) => {
        try {
            const event = {
                httpMethod: 'POST',
                body: typeof req.body === 'object' ? JSON.stringify(req.body) : req.body
            };
            const result = await mpesaTestConnection.handler(event);
            res.status(result.statusCode || 200).json(JSON.parse(result.body || '{}'));
        } catch (err) {
            console.error('Dev proxy mpesa-test-connection error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });
};
