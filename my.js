$(document).ready(function () {
    let buyPrice;
    let buyShares;
    let discount;
    let isDayTrading;
    let shares;
    let buyFee;
    let buyCost;
    let interval;
    let sellTaxRate;
    let strategy;
    let allResults = [];
    let currentResultsCount = 11;

    const STORAGE_KEY = 'daytrade-calc-inputs';

    $('#stockForm').on('submit', function (event) {
        event.preventDefault();
        buyPrice = parseFloat($('#buyPrice').val());
        buyShares = parseInt($('#buyShares').val());
        discount = parseFloat($('#discount').val()) * 100; // Convert to percentage
        isDayTrading = $('#isDayTrading').is(':checked');
        strategy = $('#strategy').val();
        shares = buyShares * 1000; // Convert to shares

        buyFee = Math.max(Math.floor(buyPrice * 0.001425 * discount * buyShares), 20);
        buyCost = Math.floor(buyPrice * shares + buyFee);

        sellTaxRate = isDayTrading ? 0.0015 : 0.003;

        interval = getInterval(buyPrice);

        allResults = [];
        currentResultsCount = 11;

        for (let i = -5; i <= 6; i++) {
            const sellPrice = round2(buyPrice + (i * interval));
            allResults.push(calculateResult(sellPrice));
        }

        displaySummary();
        displayResults();
        saveInputs();
        $('.more-results').show();
    });

    $('#showMoreTop').on('click', function () {
        addMoreResults('top');
    });

    $('#showMoreBottom').on('click', function () {
        addMoreResults('bottom');
    });

    function getInterval(price) {
        if (price < 50) return 0.05;
        if (price < 100) return 0.1;
        if (price < 500) return 0.5;
        if (price < 1000) return 1;
        return 5;
    }

    function round2(num) {
        return Math.round(num * 100) / 100;
    }

    function formatNumber(num) {
        let formattedNum = num.toFixed(2);
        if (formattedNum.endsWith('0')) {
            formattedNum = num.toFixed(1);
        }
        return formattedNum;
    }

    function computeProfit(sellPrice) {
        const sellFee = Math.max(Math.floor(sellPrice * 0.001425 * discount * buyShares), 20);
        const sellTax = Math.floor(sellPrice * shares * sellTaxRate);
        const sellIncome = Math.floor(sellPrice * shares - sellFee - sellTax);
        let profitLoss;
        if (strategy === 'long') {
            //做多
            profitLoss = Math.floor(sellIncome - buyCost);
        } else {
            //做空
            profitLoss = Math.floor((buyPrice * shares) - (sellPrice * shares) - buyFee - sellFee - sellTax);
        }
        return { profitLoss: profitLoss, sellFee: sellFee, sellTax: sellTax };
    }

    function calculateResult(sellPrice) {
        const result = computeProfit(sellPrice);
        const profitLoss = result.profitLoss;
        const totalFees = Math.floor(buyFee + result.sellFee);
        const returnPct = buyCost > 0 ? (profitLoss / buyCost * 100) : 0;
        const highlightClass = (sellPrice === buyPrice) ? 'highlight' : '';
        const profitClass = profitLoss > 0 ? 'positive' : 'negative';
        const profitColorClass = profitLoss > 0 ? 'text-danger' : 'text-success';

        const formattedSellPrice = formatNumber(sellPrice);
        const formattedProfitLoss = profitLoss.toFixed(0);
        const formattedReturnPct = returnPct.toFixed(2) + '%';
        const formattedTotalFees = totalFees.toFixed(0);
        const formattedSellTax = result.sellTax.toFixed(0);

        return `<tr class="${highlightClass}"><td>${formattedSellPrice}</td><td class="${profitClass} ${profitColorClass}">${formattedProfitLoss}</td><td class="${profitClass} ${profitColorClass}">${formattedReturnPct}</td><td>${formattedTotalFees}</td><td>${formattedSellTax}</td></tr>`;
    }

    // 找出損益兩平價：做多往上找、做空往下找第一個損益 >= 0 的價位
    function findBreakEven() {
        let price = buyPrice;
        let ticks = 0;
        for (let i = 0; i < 2000; i++) {
            if (strategy === 'long') {
                price = round2(price + getInterval(price));
            } else {
                // 往下跳一檔時，檔位間距要以低於現價的區間為準
                price = round2(price - getInterval(price - 0.0001));
                if (price <= 0) return null;
            }
            ticks++;
            if (computeProfit(price).profitLoss >= 0) {
                return { price: price, ticks: ticks };
            }
        }
        return null;
    }

    function displaySummary() {
        const breakEven = findBreakEven();
        const tickValue = Math.round(interval * shares);
        let html = '';
        if (breakEven) {
            const direction = strategy === 'long' ? '需上漲' : '需下跌';
            html += `<div class="summary-item"><span class="summary-label">損益兩平價</span><span class="summary-value">${formatNumber(breakEven.price)}</span><span class="summary-note">${direction} ${breakEven.ticks} 檔</span></div>`;
        }
        html += `<div class="summary-item"><span class="summary-label">每檔跳動</span><span class="summary-value">${formatNumber(interval)}</span><span class="summary-note">約 ${tickValue.toLocaleString()} 元／檔</span></div>`;
        html += `<div class="summary-item"><span class="summary-label">買入成本</span><span class="summary-value">${buyCost.toLocaleString()}</span><span class="summary-note">含手續費 ${buyFee} 元</span></div>`;
        $('#calcSummary').html(html).show();
    }

    function displayResults() {
        $('#resultsTable tbody tr:not(:last-child)').remove();
        $('#resultsTable tbody').prepend(allResults.slice(0, currentResultsCount).join(''));
    }

    function addMoreResults(position) {
        let lastResultPrice;
        let newResults = [];
        if (position === 'top') {
            lastResultPrice = parseFloat(allResults[0].match(/<td>([\d.]+)<\/td>/)[1]);
            for (let i = 1; i <= 5; i++) {
                const newPrice = round2(lastResultPrice - (i * interval));
                newResults.unshift(calculateResult(newPrice));
            }
            allResults = newResults.concat(allResults);
        } else {
            lastResultPrice = parseFloat(allResults[allResults.length - 1].match(/<td>([\d.]+)<\/td>/)[1]);
            for (let i = 1; i <= 5; i++) {
                const newPrice = round2(lastResultPrice + (i * interval));
                newResults.push(calculateResult(newPrice));
            }
            allResults = allResults.concat(newResults);
        }
        currentResultsCount += 5;
        displayResults();
    }

    function saveInputs() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                buyPrice: $('#buyPrice').val(),
                buyShares: $('#buyShares').val(),
                discount: $('#discount').val(),
                strategy: $('#strategy').val(),
                isDayTrading: $('#isDayTrading').is(':checked')
            }));
        } catch (e) { /* 私密瀏覽模式下 localStorage 可能不可用 */ }
    }

    function loadInputs() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch (e) {
            return null;
        }
    }

    // 還原上次輸入，沒有紀錄時使用預設值
    const saved = loadInputs();
    $('#buyPrice').val(saved && saved.buyPrice ? saved.buyPrice : 200);
    $('#buyShares').val(saved && saved.buyShares ? saved.buyShares : 1);
    $('#discount').val(saved && saved.discount ? saved.discount : 2.8);
    $('#strategy').val(saved && saved.strategy ? saved.strategy : 'long');
    $('#isDayTrading').prop('checked', saved ? saved.isDayTrading !== false : true);
    $('#stockForm').submit();
});
