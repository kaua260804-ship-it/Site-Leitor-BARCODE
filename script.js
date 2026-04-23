// ============ GLOBAL STATE ============
let productsData = [];
let eanIndex = {};
let descriptionIndex = [];
let searchHistory = [];
let scannerActive = false;
let html5QrCode = null;
let selectedAutocompleteIndex = -1;
const SCAN_COOLDOWN = 2000;
let lastScanTime = 0;
const MAX_HISTORY = 50;

// ============ DOM ELEMENTS ============
const elements = {
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    productCount: document.getElementById('productCount'),
    uploadSection: document.getElementById('uploadSection'),
    fileInput: document.getElementById('fileInput'),
    fileName: document.getElementById('fileName'),
    scannerContainer: document.getElementById('scannerContainer'),
    reader: document.getElementById('reader'),
    toggleScannerBtn: document.getElementById('toggleScannerBtn'),
    scannerStatus: document.getElementById('scannerStatus'),
    manualEan: document.getElementById('manualEan'),
    searchManualBtn: document.getElementById('searchManualBtn'),
    autocompleteDropdown: document.getElementById('autocompleteDropdown'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    historyContent: document.getElementById('historyContent'),
    loading: document.getElementById('loading'),
    resultCard: document.getElementById('resultCard'),
    resultTitle: document.getElementById('resultTitle'),
    resultEanSearched: document.getElementById('resultEanSearched'),
    resultInfo: document.getElementById('resultInfo'),
    resultIcon: document.querySelector('.result-icon'),
    toast: document.getElementById('toast'),
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content'),
};

// ============ UTILS ============
function showToast(message, type = '') {
    const toast = elements.toast;
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}

function normalizeEan(ean) {
    return String(ean).trim().replace(/[^0-9]/g, '');
}

function hideElement(el) {
    el.classList.add('hidden');
}

function showElement(el) {
    el.classList.remove('hidden');
}

// ============ FILE HANDLING ============
elements.uploadSection.addEventListener('click', () => {
    elements.fileInput.click();
});

elements.fileInput.addEventListener('change', handleFileUpload);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showElement(elements.loading);

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            processExcelData(jsonData);
            hideElement(elements.loading);
            
            elements.fileName.classList.add('show');
            elements.fileName.textContent = '📄 ' + file.name;
            elements.uploadSection.classList.add('active');
            
            showToast('Planilha carregada com sucesso!', 'success');
        } catch (error) {
            hideElement(elements.loading);
            console.error('Erro ao processar arquivo:', error);
            showToast('Erro ao carregar planilha. Verifique o formato.', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function processExcelData(data) {
    productsData = [];
    eanIndex = {};
    descriptionIndex = [];

    let currentProduct = null;
    let eanCodes = [];

    const eanRegex = /^\d{13,14}$/;
    const codeRegex = /^\d{3,5}$/;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const firstCell = String(row[0] || '').trim();

        if (firstCell.includes('SGE') || firstCell.includes('EMPRESA') ||
            firstCell.includes('DPR01') || firstCell.includes('PRODUTOS') ||
            firstCell === 'CÓDIGO' || firstCell.includes('TOTAL')) {
            continue;
        }

        if (codeRegex.test(firstCell)) {
            if (currentProduct) {
                currentProduct.eans = [...new Set(eanCodes)];
                productsData.push(currentProduct);
                addToIndexes(currentProduct);
            }

            const fornecedorRaw = String(row[4] || row[3] || '').trim();
            currentProduct = {
                codigo: firstCell,
                descricao: String(row[1] || '').trim(),
                unid: String(row[2] || '').trim(),
                fornecedor: fornecedorRaw,
                eans: []
            };
            eanCodes = [];

            for (let j = 4; j < row.length; j++) {
                const val = String(row[j] || '').trim();
                if (eanRegex.test(val)) eanCodes.push(val);
            }
        } else {
            for (let j = 0; j < row.length; j++) {
                const val = String(row[j] || '').trim();
                if (eanRegex.test(val)) eanCodes.push(val);
            }
        }
    }

    if (currentProduct) {
        currentProduct.eans = [...new Set(eanCodes)];
        productsData.push(currentProduct);
        addToIndexes(currentProduct);
    }

    updateStatusBadge();
    console.log(`Carregados ${productsData.length} produtos, ${Object.keys(eanIndex).length} EANs indexados`);
}

function addToIndexes(product) {
    product.eans.forEach(ean => {
        if (!eanIndex[ean]) eanIndex[ean] = product;
    });
    
    // Indexar por palavras da descrição para autocomplete
    if (product.descricao) {
        const words = product.descricao.toLowerCase().split(/\s+/);
        words.forEach(word => {
            if (word.length >= 3) {
                descriptionIndex.push({
                    word: word,
                    product: product
                });
            }
        });
    }
}

function updateStatusBadge() {
    if (productsData.length > 0) {
        elements.statusBadge.className = 'status-badge loaded';
        elements.statusText.textContent = 'Planilha carregada';
        elements.productCount.classList.remove('hidden');
        elements.productCount.textContent = productsData.length + ' produtos';
    } else {
        elements.statusBadge.className = 'status-badge not-loaded';
        elements.statusText.textContent = 'Planilha não carregada';
        elements.productCount.classList.add('hidden');
    }
}

// ============ AUTO-LOAD EXCEL ============
async function autoLoadExcel() {
    const paths = [
        'Produtos_Organizados.xlsx',
        './Produtos_Organizados.xlsx',
        '/Produtos_Organizados.xlsx',
    ];

    for (const path of paths) {
        try {
            const response = await fetch(path);
            if (response.ok) {
                const data = await response.arrayBuffer();
                const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                processExcelData(jsonData);
                
                elements.fileName.classList.add('show');
                elements.fileName.textContent = '📄 Carregado automaticamente';
                elements.uploadSection.classList.add('active');
                
                console.log('Planilha carregada automaticamente de:', path);
                return;
            }
        } catch (e) {
            console.log('Tentativa de carregamento de', path, 'falhou');
        }
    }
    
    console.log('Auto-carregamento não encontrou a planilha. Faça upload manual.');
}

// ============ SCANNER ============
function initScanner() {
    html5QrCode = new Html5Qrcode("reader");
}

async function startScanner() {
    if (!html5QrCode) return;

    try {
        await html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 150 },
                aspectRatio: 1.77778
            },
            onScanSuccess,
            onScanError
        );
        scannerActive = true;
        updateScannerButton();
        elements.scannerStatus.textContent = 'Aponte a câmera para um código de barras';
    } catch (err) {
        console.error('Erro ao iniciar scanner:', err);
        elements.scannerStatus.textContent = 'Erro ao acessar câmera. Verifique as permissões.';
        showToast('Erro ao acessar câmera. Use a busca manual.', 'error');
    }
}

async function stopScanner() {
    if (html5QrCode && scannerActive) {
        try {
            await html5QrCode.stop();
            scannerActive = false;
            updateScannerButton();
            elements.scannerStatus.textContent = 'Scanner pausado';
        } catch (err) {
            console.error('Erro ao parar scanner:', err);
        }
    }
}

async function toggleScanner() {
    if (scannerActive) {
        await stopScanner();
    } else {
        await startScanner();
    }
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
    if (ean.length >= 13) {
        playBeep();
        searchEan(ean);
    }
}

function onScanError(error) {
    // Ignorar erros comuns de scan
}

function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {}
}

// ============ AUTOCOMPLETE ============
elements.manualEan.addEventListener('input', handleAutocomplete);
elements.manualEan.addEventListener('keydown', handleAutocompleteKeydown);
elements.manualEan.addEventListener('focus', () => {
    if (elements.manualEan.value.trim().length >= 2) {
        handleAutocomplete();
    }
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        hideElement(elements.autocompleteDropdown);
    }
});

function handleAutocomplete() {
    const query = elements.manualEan.value.trim().toLowerCase();
    
    if (query.length < 2 || productsData.length === 0) {
        hideElement(elements.autocompleteDropdown);
        selectedAutocompleteIndex = -1;
        return;
    }
    
    // Buscar por EAN primeiro
    const eanResults = [];
    Object.keys(eanIndex).forEach(ean => {
        if (ean.includes(query)) {
            eanResults.push({ ean: ean, product: eanIndex[ean] });
        }
    });
    
    // Buscar por descrição
    const descResults = productsData.filter(p => 
        p.descricao.toLowerCase().includes(query)
    ).map(p => ({ ean: p.eans[0] || '', product: p }));
    
    // Combinar e remover duplicados
    const seen = new Set();
    const allResults = [...eanResults, ...descResults].filter(item => {
        const key = item.product.codigo;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 10);
    
    if (allResults.length === 0) {
        elements.autocompleteDropdown.innerHTML = '<div class="autocomplete-no-results">Nenhum produto encontrado</div>';
        showElement(elements.autocompleteDropdown);
        selectedAutocompleteIndex = -1;
        return;
    }
    
    elements.autocompleteDropdown.innerHTML = allResults.map((item, index) => `
        <div class="autocomplete-item" data-index="${index}" data-ean="${item.ean}">
            <span class="suggestion-code">${item.product.codigo}</span>
            <span class="suggestion-desc">${item.product.descricao}</span>
            <span class="suggestion-ean">${item.ean}</span>
        </div>
    `).join('');
    
    showElement(elements.autocompleteDropdown);
    selectedAutocompleteIndex = -1;
    
    // Adicionar click listeners
    elements.autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', function() {
            const ean = this.dataset.ean;
            elements.manualEan.value = ean;
            hideElement(elements.autocompleteDropdown);
            searchEan(ean);
        });
        item.addEventListener('mouseenter', function() {
            elements.autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            selectedAutocompleteIndex = parseInt(this.dataset.index);
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
            hideElement(elements.autocompleteDropdown);
            searchEan(ean);
        } else {
            hideElement(elements.autocompleteDropdown);
            searchManual();
        }
    } else if (e.key === 'Escape') {
        hideElement(elements.autocompleteDropdown);
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
elements.searchManualBtn.addEventListener('click', searchManual);

function searchManual() {
    const input = elements.manualEan;
    const query = normalizeEan(input.value);
    
    if (query.length >= 13) {
        // É um EAN
        searchEan(query);
    } else if (query.length > 0) {
        // Pode ser busca por descrição - pegar primeiro resultado do autocomplete
        const descResults = productsData.filter(p => 
            p.descricao.toLowerCase().includes(input.value.trim().toLowerCase())
        );
        if (descResults.length > 0) {
            searchEan(descResults[0].eans[0] || '');
        } else {
            showToast('Nenhum produto encontrado com essa descrição', 'error');
        }
    } else {
        showToast('Digite um código de barras ou nome do produto', 'error');
    }
}

function searchEan(ean) {
    if (productsData.length === 0) {
        showToast('Carregue a planilha primeiro!', 'error');
        return;
    }

    hideElement(elements.autocompleteDropdown);
    showElement(elements.loading);

    setTimeout(() => {
        hideElement(elements.loading);
        displayResult(ean);
    }, 200);
}

function displayResult(ean) {
    const product = eanIndex[ean];
    
    elements.resultCard.classList.remove('hidden');
    elements.resultCard.classList.remove('result-found', 'result-not-found');
    elements.resultEanSearched.textContent = 'EAN consultado: ' + ean;

    if (product) {
        elements.resultCard.classList.add('result-found');
        elements.resultIcon.textContent = '✅';
        elements.resultTitle.textContent = 'Produto Encontrado';

        const allEans = product.eans.map(e => {
            const isMatch = e === ean;
            return `<span class="ean-badge${isMatch ? ' match' : ''}">${e}</span>`;
        }).join('');

        elements.resultInfo.innerHTML = `
            <div class="info-item">
                <label>Código</label>
                <div class="value code">${product.codigo}</div>
            </div>
            <div class="info-item">
                <label>Descrição</label>
                <div class="value">${product.descricao || '-'}</div>
            </div>
            <div class="info-item">
                <label>Unidade</label>
                <div class="value">${product.unid || '-'}</div>
            </div>
            <div class="info-item">
                <label>Fornecedor</label>
                <div class="value">${product.fornecedor || '-'}</div>
            </div>
            <div class="info-item" style="grid-column: 1 / -1;">
                <label>Todos os EANs deste produto (${product.eans.length})</label>
                <div class="ean-list">${allEans || '<span style="color: var(--gray);">Nenhum EAN cadastrado</span>'}</div>
            </div>
        `;

        addToHistory(ean, product, true);
    } else {
        elements.resultCard.classList.add('result-not-found');
        elements.resultIcon.textContent = '⚠️';
        elements.resultTitle.textContent = 'Produto Não Encontrado';

        elements.resultInfo.innerHTML = `
            <div class="info-item" style="grid-column: 1 / -1;">
                <label>EAN Consultado</label>
                <div class="value code">${ean}</div>
            </div>
            <div class="info-item" style="grid-column: 1 / -1;">
                <label>Status</label>
                <div class="value" style="color: #856404;">Este código de barras não foi encontrado na base de dados.</div>
            </div>
        `;

        addToHistory(ean, null, false);
    }

    elements.manualEan.value = '';
    elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ============ HISTORY ============
function addToHistory(ean, product, found) {
    const entry = {
        ean: ean,
        timestamp: new Date(),
        found: found,
        codigo: product ? product.codigo : '-',
        descricao: product ? product.descricao : '-',
        fornecedor: product ? product.fornecedor : '-'
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
        <table class="history-table">
            <thead>
                <tr>
                    <th>Data/Hora</th>
                    <th>EAN</th>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    searchHistory.forEach(entry => {
        const time = entry.timestamp.toLocaleTimeString('pt-BR');
        const date = entry.timestamp.toLocaleDateString('pt-BR');
        html += `
            <tr>
                <td style="white-space: nowrap;">${date} ${time}</td>
                <td class="ean-code">${entry.ean}</td>
                <td>${entry.codigo}</td>
                <td class="description" title="${entry.descricao}">${entry.descricao}</td>
                <td>
                    <span class="badge ${entry.found ? 'badge-found' : 'badge-not-found'}">
                        ${entry.found ? '✓ Encontrado' : '✗ Não encontrado'}
                    </span>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    elements.historyContent.innerHTML = html;
}

function clearHistory() {
    searchHistory = [];
    updateHistoryDisplay();
    showToast('Histórico limpo!');
}

// ============ TABS ============
elements.tabs.forEach(tab => {
    tab.addEventListener('click', function() {
        const tabName = this.dataset.tab;
        switchTab(tabName);
    });
});

function switchTab(tabName) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));

    if (tabName === 'scanner') {
        elements.tabs[0].classList.add('active');
        document.getElementById('tab-scanner').classList.add('active');
        if (!scannerActive) startScanner();
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

elements.toggleScannerBtn.addEventListener('click', toggleScanner);
elements.clearHistoryBtn.addEventListener('click', clearHistory);

// ============ INIT ============
async function init() {
    initScanner();
    
    // Tentar carregar planilha automaticamente
    await autoLoadExcel();
    
    // Iniciar scanner (se auto-load funcionou ou se usuário fizer upload depois)
    // Não iniciamos scanner automaticamente para evitar erro de câmera
}

init();