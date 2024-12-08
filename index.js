require('dotenv').config();
const axios = require('axios');

const API_URL = 'https://sistema.lavanderia60minutos.com.br/api/v1/stores/all';
const MONITORING_URL = 'https://sistema.lavanderia60minutos.com.br/api/v1/stores_monitoring/list';
const X_TOKEN = '1be10a9c20528183b64e3c69564db6958eab7f434ee94350706adb4efc261869';
const BLYNK_BASE_URL = 'https://ny3.blynk.cloud/external/api/update';
const BLYNK_STATUS_URL = 'https://ny3.blynk.cloud/external/api/isHardwareConnected';

function extractTokenFromUrl(url) {
    const tokenMatch = url.match(/token=([^&]+)/);
    return tokenMatch ? tokenMatch[1] : undefined;
}

function createBlynkUrls(token) {
    return {
        powerOn: `${BLYNK_BASE_URL}?token=${token}&pin=V57&value=1`,
        powerOff: `${BLYNK_BASE_URL}?token=${token}&pin=V57&value=0`,
        status: `${BLYNK_STATUS_URL}?token=${token}`
    };
}

function formatTimestamp() {
    const now = new Date();
    return now.toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatTable(headers, rows) {
    const colWidths = headers.map((header, index) => {
        const maxWidth = Math.max(
            header.length,
            ...rows.map(row => String(row[index]).length)
        );
        return maxWidth;
    });

    const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const headerRow = '|' + headers.map((header, i) => 
        ` ${header.padEnd(colWidths[i])} `
    ).join('|') + '|';
    const dataRows = rows.map(row =>
        '|' + row.map((cell, i) =>
            ` ${String(cell).padEnd(colWidths[i])} `
        ).join('|') + '|'
    );

    return [separator, headerRow, separator, ...dataRows, separator].join('\n');
}

async function checkDeviceStatus(token) {
    try {
        const response = await axios.get(`${BLYNK_STATUS_URL}?token=${token}`);
        return response.data === true ? 'Conectado' : 'Desconectado';
    } catch (error) {
        return 'Erro ao verificar';
    }
}

async function fetchStoresData() {
    try {
        console.clear();
        console.log('='.repeat(80));
        console.log(`MONITORAMENTO DE LOJAS - Iniciado em ${formatTimestamp()}`);
        console.log('='.repeat(80));
        console.log('\nBuscando dados das lojas...\n');
        
        const response = await axios.get(API_URL, {
            headers: {
                'X-Token': X_TOKEN
            }
        });

        let storesData = response.data;
        if (!Array.isArray(storesData)) {
            const possibleDataFields = Object.keys(response.data);
            for (const field of possibleDataFields) {
                if (Array.isArray(response.data[field])) {
                    storesData = response.data[field];
                    break;
                }
            }
        }

        if (!Array.isArray(storesData)) {
            throw new Error('Não foi possível encontrar um array de lojas na resposta da API');
        }

        const stats = {
            total: storesData.length,
            porEstado: {},
            status: {
                conectados: 0,
                desconectados: 0,
                erro: 0
            },
            lojasComErro: [],
            statusPorEstado: {}
        };
        
        console.log('Verificando status dos dispositivos...\n');
        
        const storePromises = storesData.map(async store => {
            const token = extractTokenFromUrl(store.blynk_power_on);
            const blynkUrls = createBlynkUrls(token);
            const status = await checkDeviceStatus(token);
            
            stats.porEstado[store.state] = (stats.porEstado[store.state] || 0) + 1;
            
            if (!stats.statusPorEstado[store.state]) {
                stats.statusPorEstado[store.state] = {
                    conectados: 0,
                    desconectados: 0,
                    erro: 0,
                    total: 0
                };
            }
            
            if (status === 'Conectado') {
                stats.status.conectados++;
                stats.statusPorEstado[store.state].conectados++;
            } else if (status === 'Desconectado') {
                stats.status.desconectados++;
                stats.statusPorEstado[store.state].desconectados++;
            } else {
                stats.status.erro++;
                stats.statusPorEstado[store.state].erro++;
                stats.lojasComErro.push({
                    code: store.code,
                    state: store.state,
                    token: token
                });
            }
            stats.statusPorEstado[store.state].total++;
            
            return {
                code: store.code,
                state: store.state,
                status: status,
                urls: blynkUrls
            };
        });

        const results = await Promise.all(storePromises);
        
        // Lista de todas as lojas com seus links
        console.log('\nEndereços de Acionamento por Loja:');
        console.log('='.repeat(80));
        
        // Ordenar lojas por estado e código
        results.sort((a, b) => {
            if (a.state === b.state) {
                return a.code.localeCompare(b.code);
            }
            return a.state.localeCompare(b.state);
        });

        let currentState = '';
        results.forEach(store => {
            if (currentState !== store.state) {
                currentState = store.state;
                console.log(`\n[Estado: ${currentState}]`);
                console.log('-'.repeat(80));
            }

            console.log(`\nLoja: ${store.code} (${store.status})`);
            console.log(`Ligar........: ${store.urls.powerOn}`);
            console.log(`Desligar.....: ${store.urls.powerOff}`);
            console.log(`Verificar....: ${store.urls.status}`);
            console.log('-'.repeat(80));
        });

        // Início do Resumo Geral
        console.log('\n' + '='.repeat(80));
        console.log('RESUMO GERAL DO MONITORAMENTO');
        console.log('='.repeat(80));
        
        // Status geral dos dispositivos
        const statusHeaders = ['Status', 'Quantidade', 'Percentual'];
        const statusRows = [
            ['Conectados', stats.status.conectados, `${((stats.status.conectados/stats.total)*100).toFixed(1)}%`],
            ['Desconectados', stats.status.desconectados, `${((stats.status.desconectados/stats.total)*100).toFixed(1)}%`],
            ['Erro', stats.status.erro, `${((stats.status.erro/stats.total)*100).toFixed(1)}%`],
            ['Total', stats.total, '100.0%']
        ];
        
        console.log('\nStatus Geral dos Dispositivos:');
        console.log(formatTable(statusHeaders, statusRows));
        
        // Distribuição por estado
        const estadosHeaders = ['Estado', 'Quantidade', 'Percentual'];
        const estadosRows = Object.entries(stats.porEstado)
            .sort((a, b) => b[1] - a[1])
            .map(([estado, quantidade]) => [
                estado,
                quantidade,
                `${((quantidade/stats.total)*100).toFixed(1)}%`
            ]);
        
        console.log('\nDistribuição por Estado:');
        console.log(formatTable(estadosHeaders, estadosRows));

        // Resumo detalhado por estado
        console.log('\nStatus Detalhado por Estado:');
        Object.entries(stats.statusPorEstado)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([estado, statusData]) => {
                console.log(`\n[Estado: ${estado}]`);
                const estadoHeaders = ['Status', 'Quantidade', 'Percentual'];
                const estadoRows = [
                    ['Conectados', statusData.conectados, `${((statusData.conectados/statusData.total)*100).toFixed(1)}%`],
                    ['Desconectados', statusData.desconectados, `${((statusData.desconectados/statusData.total)*100).toFixed(1)}%`],
                    ['Erro', statusData.erro, `${((statusData.erro/statusData.total)*100).toFixed(1)}%`],
                    ['Total', statusData.total, '100.0%']
                ];
                console.log(formatTable(estadoHeaders, estadoRows));
            });
        
        // Lista detalhada de lojas com erro
        if (stats.lojasComErro.length > 0) {
            console.log('\nALERTA: Lojas com Erro de Verificação:');
            const erroHeaders = ['Código', 'Estado', 'Token'];
            const erroRows = stats.lojasComErro.map(loja => [
                loja.code,
                loja.state,
                loja.token
            ]);
            console.log(formatTable(erroHeaders, erroRows));
        }

        // Rodapé
        console.log('\n' + '='.repeat(80));
        console.log(`Monitoramento concluído em ${formatTimestamp()}`);
        console.log('='.repeat(80));

        // Buscar dados do monitoramento
        console.log('\nBuscando dados do monitoramento...');
        const monitoringResponse = await axios.get(MONITORING_URL, {
            headers: {
                'X-Token': X_TOKEN
            }
        });

        const monitoringData = monitoringResponse.data;
        
        // Verificar se os dados estão em alguma propriedade do objeto
        let monitoringArray = null;
        if (typeof monitoringData === 'object' && !Array.isArray(monitoringData)) {
            // Procurar por uma propriedade que contenha um array
            for (const key in monitoringData) {
                if (Array.isArray(monitoringData[key])) {
                    monitoringArray = monitoringData[key];
                    break;
                }
            }
        } else if (Array.isArray(monitoringData)) {
            monitoringArray = monitoringData;
        }

        if (monitoringArray && monitoringArray.length > 0) {
            console.log('\nDados do Monitoramento:');
            console.log('='.repeat(80));

            // Estatísticas de monitoramento
            const monitoringStats = {
                total: monitoringArray.length,
                porStatus: {},
                porEstado: {},
                porTipoErro: {}
            };

            // Exibir tabela de dados
            const monitoringHeaders = ['Código', 'Status', 'Tipo de Erro', 'Data'];
            const monitoringRows = monitoringArray.map(item => {
                const attrs = item.attributes || {};
                
                // Contagem por status
                if (attrs.status) {
                    monitoringStats.porStatus[attrs.status] = (monitoringStats.porStatus[attrs.status] || 0) + 1;
                }

                // Contagem por tipo de erro
                if (attrs.error_type) {
                    monitoringStats.porTipoErro[attrs.error_type] = (monitoringStats.porTipoErro[attrs.error_type] || 0) + 1;
                }

                return [
                    attrs.store_code || 'N/A',
                    attrs.status || 'N/A',
                    attrs.error_type || 'N/A',
                    attrs.created_at ? new Date(attrs.created_at).toLocaleString('pt-BR') : 'N/A'
                ];
            });

            console.log(formatTable(monitoringHeaders, monitoringRows));

            // Exibir resumo por status
            console.log('\nResumo por Status:');
            console.log('='.repeat(80));
            const statusHeaders = ['Status', 'Quantidade', 'Percentual'];
            const statusRows = Object.entries(monitoringStats.porStatus)
                .map(([status, quantidade]) => [
                    status,
                    quantidade,
                    `${((quantidade/monitoringStats.total)*100).toFixed(1)}%`
                ]);
            console.log(formatTable(statusHeaders, statusRows));

            // Exibir resumo por tipo de erro
            if (Object.keys(monitoringStats.porTipoErro).length > 0) {
                console.log('\nResumo por Tipo de Erro:');
                console.log('='.repeat(80));
                const erroHeaders = ['Tipo de Erro', 'Quantidade', 'Percentual'];
                const erroRows = Object.entries(monitoringStats.porTipoErro)
                    .map(([tipo, quantidade]) => [
                        tipo,
                        quantidade,
                        `${((quantidade/monitoringStats.total)*100).toFixed(1)}%`
                    ]);
                console.log(formatTable(erroHeaders, erroRows));
            }

            console.log(`\nTotal de registros de monitoramento: ${monitoringStats.total}`);
        } else {
            console.log('Nenhum dado de monitoramento encontrado');
        }
        
        return true;
    } catch (error) {
        console.error('\nERRO NO MONITORAMENTO:');
        console.error('='.repeat(50));
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Mensagem:', error.response.data);
        } else {
            console.error('Erro:', error.message);
        }
        console.error('='.repeat(50));
        return false;
    }
}

// Executar o script
fetchStoresData(); 