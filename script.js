// ============ GLOBAL STATE ============
let productsData = [];
let eanIndex = {};
let codeIndex = {};
let descriptionIndex = [];
let searchHistory = [];
let scannerActive = false;
let html5QrCode = null;
let selectedAutocompleteIndex = -1;
const SCAN_COOLDOWN = 2000;
let lastScanTime = 0;
const MAX_HISTORY = 50;
let cameraAttempts = 0;
const MAX_CAMERA_ATTEMPTS = 2;

// ============ DOM ELEMENTS ============
const $ = (id) => document.getElementById(id);

const elements = {
    statusBadge: $('statusBadge'),
    statusText: $('statusText'),
    productCount: $('productCount'),
    uploadSection: $('uploadSection'),
    fileInput: $('fileInput'),
    fileName: $('fileName'),
    scannerContainer: $('scannerContainer'),
    reader: $('reader'),
    toggleScannerBtn: $('toggleScannerBtn'),
    retryCameraBtn: $('retryCameraBtn'),
    scannerStatus: $('scannerStatus'),
    cameraError: $('cameraError'),
    manualEan: $('manualEan'),
    searchManualBtn: $('searchManualBtn'),
    autocompleteDropdown: $('autocompleteDropdown'),
    clearHistoryBtn: $('clearHistoryBtn'),
    historyContent: $('historyContent'),
    loading: $('loading'),
    resultCard: $('resultCard'),
    resultTitle: $('resultTitle'),
    resultEanSearched: $('resultEanSearched'),
    resultInfo: $('resultInfo'),
    toast: $('toast'),
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content'),
};

// Mapeamento das colunas da nova planilha
const COLUMN_MAP = {
    'cod_sge': 'COD SGE',
    'desc_sge': 'DESC SGE', 
    'unid': 'UNID',
    'cod_fml_consinco': 'COD FML CONSINCO',
    'cod_prd_consinco': 'COD PRD CONSINCO',
    'desc_consinco': 'DESC CONSINCO',
    'fornecedor_cod': 'FORNECEDOR_COD',
    'fornecedor': 'FORNECEDOR',
    'ean_start': 8 // Índice onde começam as colunas EAN (EAN1, EAN2...)
};

// ============ UTILS ============
function showToast(message, type = '') {
    const toast = elements.toast;
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}

function normalizeEan(ean) {
    return String(ean).trim().replace(/[^0-9]/g, '');
}

function normalizeCode(code) {
    return String(code).trim().replace(/^0+/, '');
}

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============ FILE HANDLING ============
elements.uploadSection.addEventListener('click', () => {
    if (!elements.uploadSection.classList.contains('active')) {
        elements.fileInput.click();
    }
});

elements.fileInput.addEventListener('change', handleFileUpload);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    elements.loading.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            processExcelDataNew(jsonData);
            elements.loading.classList.add('hidden');
            
            elements.fileName.classList.add('show');
            elements.fileName.textContent = '📄 ' + file.name;
            elements.uploadSection.classList.add('active');
            
            showToast('✅ Planilha carregada! ' + productsData.length + ' produtos', 'success');
        } catch (error) {
            elements.loading.classList.add('hidden');
            console.error('Erro ao processar arquivo:', error);
            showToast('❌ Erro ao carregar planilha', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function processExcelDataNew(data) {
    productsData = [];
    eanIndex = {};
    codeIndex = {};
    descriptionIndex = [];

    if (data.length < 2) {
        console.error('Planilha vazia ou muito pequena');
        return;
    }

    // A primeira linha deve ser o cabeçalho
    const headerRow = data[0];
    console.log('📋 Cabeçalhos encontrados:', headerRow);

    // Encontrar índices das colunas principais
    const colIndexes = {};
    headerRow.forEach((col, index) => {
        const colUpper = String(col).toUpperCase().trim();
        if (colUpper.includes('COD SGE') || colUpper === 'CÓDIGO') colIndexes.cod_sge = index;
        if (colUpper.includes('DESC SGE') || colUpper === 'DESCRIÇÃO') colIndexes.desc_sge = index;
        if (colUpper === 'UNID' || colUpper === 'UN') colIndexes.unid = index;
        if (colUpper.includes('COD FML')) colIndexes.cod_fml = index;
        if (colUpper.includes('COD PRD')) colIndexes.cod_prd = index;
        if (colUpper.includes('DESC CONSINCO')) colIndexes.desc_consinco = index;
        if (colUpper.includes('FORNECEDOR_COD') || (colUpper.includes('FORNECEDOR') && !colUpper.includes('NOME'))) colIndexes.forn_cod = index;
        if (colUpper === 'FORNECEDOR' || colUpper.includes('NOME FORNECEDOR')) colIndexes.forn_nome = index;
        if (colUpper.startsWith('EAN')) colIndexes.ean_start = Math.min(colIndexes.ean_start || 999, index);
    });

    console.log('🔍 Índices das colunas:', colIndexes);

    // Processar dados a partir da linha 1
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const codSge = normalizeCode(String(row[colIndexes.cod_sge] || '').trim());
        
        if (!codSge || codSge === '0') continue;

        // Extrair EANs
        const eans = [];
        if (colIndexes.ean_start !== undefined) {
            for (let j = colIndexes.ean_start; j < row.length; j++) {
                const val = normalizeEan(String(row[j] || ''));
                if (val.length >= 13) {
                    eans.push(val);
                }
            }
        }

        // Se não encontrou pela coluna EAN, procurar em todas as colunas
        if (eans.length === 0) {
            for (let j = 0; j < row.length; j++) {
                const val = normalizeEan(String(row[j] || ''));
                if (val.length >= 13 && !eans.includes(val)) {
                    eans.push(val);
                }
            }
        }

        const product = {
            cod_sge: codSge,
            desc_sge: String(row[colIndexes.desc_sge] || '').trim(),
            unid: String(row[colIndexes.unid] || '').trim(),
            cod_fml_consinco: String(row[colIndexes.cod_fml] || '').trim(),
            cod_prd_consinco: String(row[colIndexes.cod_prd] || '').trim(),
            desc_consinco: String(row[colIndexes.desc_consinco] || '').trim(),
            fornecedor_cod: String(row[colIndexes.forn_cod] || '').trim(),
            fornecedor_nome: String(row[colIndexes.forn_nome] || '').trim(),
            eans: eans
        };

        productsData.push(product);

        // Indexar por EAN
        eans.forEach(ean => {
            if (!eanIndex[ean]) eanIndex[ean] = product;
        });

        // Indexar por código SGE
        codeIndex[codSge] = product;
        
        // Também indexar pelo código CONSINCO se existir
        if (product.cod_prd_consinco) {
            codeIndex[normalizeCode(product.cod_prd_consinco)] = product;
        }
    }

    updateStatusBadge();
    console.log(`✅ Carregados ${productsData.length} produtos, ${Object.keys(eanIndex).length} EANs`);
}

function updateStatusBadge() {
    if (productsData.length > 0) {
        elements.statusBadge.className = 'status-badge loaded';
        elements.statusText.textContent = '✅ Planilha carregada';
        elements.productCount.classList.remove('hidden');
        elements.productCount.textContent = productsData.length + ' produtos';
    } else {
        elements.statusBadge.className = 'status-badge not-loaded';
        elements.statusText.textContent = '⚠️ Planilha não carregada';
        elements.productCount.classList.add('hidden');
    }
}

// ============ AUTO-LOAD EXCEL ============
async function autoLoadExcel() {
    const paths = [
        'Produtos_Organizados.xlsx',
        './Produtos_Organizados.xlsx',
        '/Produtos_Organizados.xlsx',
        '/Site-Leitor-BARCODE/Produtos_Organizados.xlsx',
        'Kaua Souza - Prd01 - Relatório de Codificação dos Produtos.xlsx',
        '/Kaua Souza - Prd01 - Relatório de Codificação dos Produtos.xlsx',
    ];

    for (const path of paths) {
        try {
            console.log('🔄 Tentando carregar:', path);
            const response = await fetch(path);
            if (response.ok) {
                const data = await response.arrayBuffer();
                const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                processExcelDataNew(jsonData);
                
                elements.fileName.classList.add('show');
                elements.fileName.textContent = '📄 Carregado automaticamente';
                elements.uploadSection.classList.add('active');
                
                console.log('✅ Planilha carregada de:', path);
                showToast('✅ Planilha carregada! ' + productsData.length + ' produtos', 'success');
                return true;
            }
        } catch (e) {
            console.log('❌ Falha ao carregar de:', path);
        }
    }
    
    console.log('⚠️ Auto-carregamento não encontrou a planilha');
    return false;
}

// ============ SCANNER ============
function initScanner() {
    if (html5QrCode) {
        try { html5QrCode.clear(); } catch(e) {}
    }
    html5QrCode = new Html5Qrcode("reader");
}

async function startScanner() {
    if (!html5QrCode) initScanner();
    if (scannerActive) return;

    elements.scannerStatus.textContent = '🔄 Solicitando acesso à câmera...';
    elements.cameraError.classList.add('hidden');
    elements.retryCameraBtn.classList.add('hidden');
    elements.scannerContainer.style.display = 'block';

    const cameraConfigs = [
        { facingMode: "environment" },
        { facingMode: { exact: "environment" } },
        { deviceId: "default" },
        { facingMode: "user" },
    ];

    let started = false;
    
    for (const config of cameraConfigs) {
        if (started) break;
        try {
            if (html5QrCode.isScanning) await html5QrCode.stop();
            
            await html5QrCode.start(
                config,
                {
                    fps: 10,
                    qrbox: function(viewfinderWidth, viewfinderHeight) {
                        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                        const qrboxSize = Math.floor(minEdge * 0.6);
                        return { width: qrboxSize, height: qrboxSize };
                    },
                    aspectRatio: 1.77778,
                },
                onScanSuccess,
                onScanError
            );
            
            scannerActive = true;
            started = true;
            cameraAttempts = 0;
            updateScannerButton();
            elements.scannerStatus.textContent = '📷 Aponte a câmera para um código de barras';
            elements.cameraError.classList.add('hidden');
            elements.retryCameraBtn.classList.add('hidden');
        } catch (err) {
            console.log('❌ Falha com config:', config, err.message);
        }
    }

    if (!started) handleCameraError();
}

async function stopScanner() {
    if (html5QrCode && scannerActive) {
        try {
            await html5QrCode.stop();
            scannerActive = false;
            updateScannerButton();
            elements.scannerStatus.textContent = '⏸️ Scanner pausado';
        } catch (err) {
            console.error('Erro ao parar scanner:', err);
        }
    }
}

function handleCameraError() {
    scannerActive = false;
    cameraAttempts++;
    updateScannerButton();
    elements.scannerStatus.textContent = '❌ Erro ao acessar a câmera';
    elements.cameraError.classList.remove('hidden');
    elements.scannerContainer.style.display = 'none';
    
    if (cameraAttempts < MAX_CAMERA_ATTEMPTS) {
        elements.retryCameraBtn.classList.remove('hidden');
    } else {
        elements.retryCameraBtn.classList.add('hidden');
        elements.scannerStatus.textContent = '❌ Câmera indisponível. Use a busca manual.';
    }
}

async function toggleScanner() {
    if (scannerActive) {
        await stopScanner();
    } else {
        await startScanner();
    }
}

async function retryCamera() {
    elements.cameraError.classList.add('hidden');
    elements.retryCameraBtn.classList.add('hidden');
    elements.scannerContainer.style.display = 'block';
    elements.scannerStatus.textContent = '🔄 Tentando novamente...';
    await startScanner();
}

function updateScannerButton() {
    const btn = elements.toggleScannerBtn;
    if (scannerActive) {
        btn.innerHTML = '⏸️ Parar Scanner';
        btn.className = 'btn btn-outline';
    } else {
        btn.innerHTML = '▶️ Iniciar Scanner';
        btn.className = 'btn btn-success';
    }
}

function onScanSuccess(decodedText) {
    const now = Date.now();
    if (now - lastScanTime < SCAN_COOLDOWN) return;
    lastScanTime = now;

    const ean = normalizeEan(decodedText);
    console.log('📱 EAN escaneado:', ean);
    
    if (ean.length >= 13) {
        playBeep();
        searchEan(ean);
    }
}

function onScanError(error) {
    if (error && error.includes('NotFoundException')) return;
}

function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.15;
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
}

// ============ AUTOCOMPLETE ============
elements.manualEan.addEventListener('input', handleAutocomplete);
elements.manualEan.addEventListener('keydown', handleAutocompleteKeydown);
elements.manualEan.addEventListener('focus', () => {
    if (elements.manualEan.value.trim().length >= 2) handleAutocomplete();
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        elements.autocompleteDropdown.classList.add('hidden');
        selectedAutocompleteIndex = -1;
    }
});

function handleAutocomplete() {
    const query = elements.manualEan.value.trim();
    const queryNormalized = normalizeEan(query);
    
    if (query.length < 2 || productsData.length === 0) {
        elements.autocompleteDropdown.classList.add('hidden');
        selectedAutocompleteIndex = -1;
        return;
    }
    
    const results = [];
    const seen = new Set();
    
    // Buscar por EAN
    Object.keys(eanIndex).forEach(ean => {
        if (ean.includes(queryNormalized) && !seen.has(eanIndex[ean].cod_sge)) {
            results.push({ ean: ean, product: eanIndex[ean] });
            seen.add(eanIndex[ean].cod_sge);
        }
    });
    
    // Buscar por código SGE
    if (results.length < 10) {
        productsData.forEach(p => {
            if (!seen.has(p.cod_sge) && p.cod_sge.includes(query)) {
                results.push({ ean: p.eans[0] || '', product: p });
                seen.add(p.cod_sge);
            }
        });
    }
    
    // Buscar por descrição SGE
    if (results.length < 10) {
        const searchLower = query.toLowerCase();
        productsData.forEach(p => {
            if (!seen.has(p.cod_sge) && p.desc_sge.toLowerCase().includes(searchLower)) {
                results.push({ ean: p.eans[0] || '', product: p });
                seen.add(p.cod_sge);
            }
        });
    }
    
    // Buscar por descrição CONSINCO
    if (results.length < 10) {
        const searchLower = query.toLowerCase();
        productsData.forEach(p => {
            if (!seen.has(p.cod_sge) && p.desc_consinco && p.desc_consinco.toLowerCase().includes(searchLower)) {
                results.push({ ean: p.eans[0] || '', product: p });
                seen.add(p.cod_sge);
            }
        });
    }
    
    // Buscar por código CONSINCO
    if (results.length < 10) {
        const queryCode = normalizeCode(query);
        productsData.forEach(p => {
            if (!seen.has(p.cod_sge) && p.cod_prd_consinco && normalizeCode(p.cod_prd_consinco).includes(queryCode)) {
                results.push({ ean: p.eans[0] || '', product: p });
                seen.add(p.cod_sge);
            }
        });
    }
    
    const limitedResults = results.slice(0, 10);
    
    if (limitedResults.length === 0) {
        elements.autocompleteDropdown.innerHTML = '<div class="autocomplete-no-results">Nenhum produto encontrado</div>';
        elements.autocompleteDropdown.classList.remove('hidden');
        selectedAutocompleteIndex = -1;
        return;
    }
    
    elements.autocompleteDropdown.innerHTML = limitedResults.map((item, index) => `
        <div class="autocomplete-item" data-index="${index}" data-ean="${item.ean}">
            <span class="suggestion-code">${item.product.cod_sge}</span>
            <span class="suggestion-desc">${item.product.desc_sge}</span>
            <span class="suggestion-ean">${item.ean}</span>
        </div>
    `).join('');
    
    elements.autocompleteDropdown.classList.remove('hidden');
    selectedAutocompleteIndex = -1;
    
    elements.autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', function() {
            const ean = this.dataset.ean;
            if (ean) {
                elements.manualEan.value = ean;
                elements.autocompleteDropdown.classList.add('hidden');
                searchEan(ean);
            }
        });
    });
}

function handleAutocompleteKeydown(e) {
    const items = elements.autocompleteDropdown.querySelectorAll('.autocomplete-item');
    
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length > 0) {
            selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
            updateAutocompleteSelection(items);
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length > 0) {
            selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
            updateAutocompleteSelection(items);
        }
    } else if (e.key === 'Enter') {
        if (selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
            e.preventDefault();
            const ean = items[selectedAutocompleteIndex].dataset.ean;
            elements.manualEan.value = ean;
            elements.autocompleteDropdown.classList.add('hidden');
            searchEan(ean);
        } else {
            elements.autocompleteDropdown.classList.add('hidden');
            searchByQuery(elements.manualEan.value.trim());
        }
    } else if (e.key === 'Escape') {
        elements.autocompleteDropdown.classList.add('hidden');
        selectedAutocompleteIndex = -1;
    }
}

function updateAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === selectedAutocompleteIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

// ============ SEARCH ============
elements.searchManualBtn.addEventListener('click', () => {
    searchByQuery(elements.manualEan.value.trim());
});

elements.manualEan.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !elements.autocompleteDropdown.querySelector('.autocomplete-item.active')) {
        searchByQuery(elements.manualEan.value.trim());
    }
});

function searchByQuery(query) {
    elements.autocompleteDropdown.classList.add('hidden');
    
    if (!query) {
        showToast('Digite algo para buscar', 'error');
        return;
    }
    
    const queryNormalized = normalizeEan(query);
    
    if (queryNormalized.length >= 13) {
        // É um EAN
        searchEan(queryNormalized);
        return;
    }
    
    // Buscar por código SGE
    const byCode = productsData.filter(p => p.cod_sge === normalizeCode(query));
    if (byCode.length > 0) {
        searchEan(byCode[0].eans[0] || '');
        return;
    }
    
    // Buscar por descrição
    const searchLower = query.toLowerCase();
    const byDesc = productsData.filter(p => 
        p.desc_sge.toLowerCase().includes(searchLower) ||
        (p.desc_consinco && p.desc_consinco.toLowerCase().includes(searchLower))
    );
    
    if (byDesc.length > 0) {
        searchEan(byDesc[0].eans[0] || '');
        return;
    }
    
    showToast('Nenhum produto encontrado', 'error');
}

function searchManual() {
    searchByQuery(elements.manualEan.value.trim());
}

function searchEan(ean) {
    if (productsData.length === 0) {
        showToast('⚠️ Carregue a planilha primeiro!', 'error');
        return;
    }

    elements.autocompleteDropdown.classList.add('hidden');
    elements.loading.classList.remove('hidden');

    setTimeout(() => {
        elements.loading.classList.add('hidden');
        displayResult(ean);
    }, 200);
}

function displayResult(ean) {
    const product = eanIndex[ean];
    
    elements.resultCard.classList.remove('hidden');
    elements.resultCard.classList.remove('result-found', 'result-not-found');
    elements.resultEanSearched.textContent = '🔍 Pesquisado: ' + ean;

    if (product) {
        elements.resultCard.classList.add('result-found');
        elements.resultTitle.textContent = '✅ Produto Encontrado';

        const allEans = product.eans.map(e => {
            const isMatch = e === ean;
            return `<span class="ean-badge${isMatch ? ' match' : ''}">${e}</span>`;
        }).join('');

        elements.resultInfo.innerHTML = `
            <div class="info-item">
                <label>📦 Código SGE</label>
                <div class="value code">${product.cod_sge}</div>
            </div>
            <div class="info-item">
                <label>📝 Descrição SGE</label>
                <div class="value">${escHtml(product.desc_sge) || '-'}</div>
            </div>
            <div class="info-item">
                <label>📏 Unidade</label>
                <div class="value">${escHtml(product.unid) || '-'}</div>
            </div>
            <div class="info-item">
                <label>🔢 Cód. Família Consinco</label>
                <div class="value code">${product.cod_fml_consinco || '-'}</div>
            </div>
            <div class="info-item">
                <label>🔢 Cód. Produto Consinco</label>
                <div class="value code">${product.cod_prd_consinco || '-'}</div>
            </div>
            <div class="info-item">
                <label>📝 Descrição Consinco</label>
                <div class="value">${escHtml(product.desc_consinco) || '-'}</div>
            </div>
            <div class="info-item">
                <label>🏢 Cód. Fornecedor</label>
                <div class="value code">${product.fornecedor_cod || '-'}</div>
            </div>
            <div class="info-item">
                <label>🏢 Fornecedor</label>
                <div class="value">${escHtml(product.fornecedor_nome) || '-'}</div>
            </div>
            <div class="info-item" style="grid-column: 1 / -1;">
                <label>🏷️ Códigos de Barras (${product.eans.length})</label>
                <div class="ean-list">${allEans || '<span style="color: var(--gray);">Nenhum EAN cadastrado</span>'}</div>
            </div>
        `;

        addToHistory(ean, product, true);
    } else {
        elements.resultCard.classList.add('result-not-found');
        elements.resultTitle.textContent = '❌ Produto Não Encontrado';

        elements.resultInfo.innerHTML = `
            <div class="info-item" style="grid-column: 1 / -1;">
                <label>🔍 Pesquisado</label>
                <div class="value code">${ean}</div>
            </div>
            <div class="info-item" style="grid-column: 1 / -1;">
                <label>📋 Status</label>
                <div class="value" style="color: #856404;">Não encontrado na base de dados.</div>
            </div>
        `;

        addToHistory(ean, null, false);
    }

    elements.manualEan.value = '';
    
    setTimeout(() => {
        elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// ============ HISTORY ============
function addToHistory(ean, product, found) {
    const entry = {
        ean: ean,
        timestamp: new Date(),
        found: found,
        codigo: product ? product.cod_sge : '-',
        descricao: product ? product.desc_sge : '-',
        fornecedor: product ? product.fornecedor_nome : '-'
    };

    searchHistory.unshift(entry);
    if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
    updateHistoryDisplay();
}

function updateHistoryDisplay() {
    if (searchHistory.length === 0) {
        elements.historyContent.innerHTML = '<p style="text-align: center; color: var(--gray); padding: 20px;">Nenhuma consulta realizada</p>';
        return;
    }

    let html = `
        <div style="overflow-x: auto;">
        <table class="history-table">
            <thead>
                <tr>
                    <th>Hora</th>
                    <th>EAN</th>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    searchHistory.forEach(entry => {
        const time = entry.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        html += `
            <tr>
                <td style="white-space: nowrap; font-size: 0.8rem;">${time}</td>
                <td class="ean-code">${entry.ean}</td>
                <td>${entry.codigo}</td>
                <td class="description" title="${escHtml(entry.descricao)}">${escHtml(entry.descricao)}</td>
                <td>
                    <span class="badge ${entry.found ? 'badge-found' : 'badge-not-found'}">
                        ${entry.found ? '✓' : '✗'}
                    </span>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    elements.historyContent.innerHTML = html;
}

function clearHistory() {
    searchHistory = [];
    updateHistoryDisplay();
    showToast('🗑️ Histórico limpo!');
}

// ============ TABS ============
elements.tabs.forEach(tab => {
    tab.addEventListener('click', function() {
        switchTab(this.dataset.tab);
    });
});

function switchTab(tabName) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));

    if (tabName === 'scanner') {
        elements.tabs[0].classList.add('active');
        document.getElementById('tab-scanner').classList.add('active');
        if (!scannerActive && productsData.length > 0) startScanner();
    } else if (tabName === 'manual') {
        elements.tabs[1].classList.add('active');
        document.getElementById('tab-manual').classList.add('active');
        stopScanner();
        setTimeout(() => elements.manualEan.focus(), 100);
    } else if (tabName === 'history') {
        elements.tabs[2].classList.add('active');
        document.getElementById('tab-history').classList.add('active');
        stopScanner();
    }
}

// ============ EVENT LISTENERS ============
elements.toggleScannerBtn.addEventListener('click', toggleScanner);
elements.retryCameraBtn.addEventListener('click', retryCamera);
elements.clearHistoryBtn.addEventListener('click', clearHistory);

// Swipe para mobile
let touchStartX = 0;
document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
});

document.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 80) {
        const activeTab = document.querySelector('.tab.active');
        const tabs = Array.from(elements.tabs);
        const idx = tabs.indexOf(activeTab);
        if (diff < 0 && idx < tabs.length - 1) switchTab(tabs[idx + 1].dataset.tab);
        else if (diff > 0 && idx > 0) switchTab(tabs[idx - 1].dataset.tab);
    }
});

// ============ INIT ============
async function init() {
    console.log('🚀 Iniciando FRIBAL Scan v2...');
    
    initScanner();
    const loaded = await autoLoadExcel();
    
    if (loaded) {
        setTimeout(async () => {
            await startScanner();
        }, 1000);
    } else {
        elements.scannerStatus.textContent = '⚠️ Carregue a planilha para usar o scanner';
    }
}

init();
