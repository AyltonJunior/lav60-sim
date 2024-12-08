require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, onValue } = require('firebase/database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAl5ZbgWviD4vf-3BjOZB9uQGhxPQT7Dy0",
    databaseURL: "https://lav60-sim-default-rtdb.firebaseio.com",
    projectId: "lav60-sim"
};

// Inicializar Firebase
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// Configuração da API da Lavanderia
const API_URL = 'https://sistema.lavanderia60minutos.com.br/api/v1/stores/all';
const MONITORING_URL = 'https://sistema.lavanderia60minutos.com.br/api/v1/stores_monitoring/list';
const X_TOKEN = '1be10a9c20528183b64e3c69564db6958eab7f434ee94350706adb4efc261869';

async function fetchAndSaveData() {
    try {
        // Buscar dados das lojas
        const [storesResponse, monitoringResponse] = await Promise.all([
            axios.get(API_URL, { headers: { 'X-Token': X_TOKEN } }),
            axios.get(MONITORING_URL, { headers: { 'X-Token': X_TOKEN } })
        ]);

        const monitoringData = monitoringResponse.data;
        const storesData = storesResponse.data;

        // Processar dados
        const processedData = {
            timestamp: new Date().toISOString(),
            stores: storesData,
            monitoring: monitoringData,
            stats: {
                totalStores: Array.isArray(storesData) ? storesData.length : 0,
                totalMonitoring: Array.isArray(monitoringData) ? monitoringData.length : 0
            }
        };

        // Salvar no Firebase
        await set(ref(database, 'monitoring/' + Date.now()), processedData);
        console.log('Dados salvos no Firebase:', new Date().toLocaleString());

    } catch (error) {
        console.error('Erro ao buscar ou salvar dados:', error);
    }
}

// Rotas da API
app.get('/api/data', async (req, res) => {
    try {
        const monitoringRef = ref(database, 'monitoring');
        onValue(monitoringRef, (snapshot) => {
            const data = snapshot.val();
            res.json(data);
        }, {
            onlyOnce: true
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Iniciar o monitoramento
setInterval(fetchAndSaveData, 60000); // Executa a cada 1 minuto
fetchAndSaveData(); // Executa imediatamente na primeira vez

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
}); 