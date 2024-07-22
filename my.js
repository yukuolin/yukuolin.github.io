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
            const sellPrice = buyPrice + (i * interval);
            allResults.push(calculateResult(sellPrice));
        }

        displayResults();
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

    function formatNumber(num) {
        let formattedNum = num.toFixed(2);
        if (formattedNum.endsWith('0')) {
            formattedNum = num.toFixed(1);
        }
        return formattedNum;
    }

    function calculateResult(sellPrice) {
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
        const totalFees = Math.floor(buyFee + sellFee);
        const highlightClass = (sellPrice === buyPrice) ? 'highlight' : '';
        const profitClass = profitLoss > 0 ? 'positive' : 'negative';
        const profitColorClass = profitLoss > 0 ? 'text-danger' : 'text-success'; 

        const formattedSellPrice = formatNumber(sellPrice);
        const formattedProfitLoss = profitLoss.toFixed(0); 
        const formattedTotalFees = totalFees.toFixed(0); 
        const formattedSellTax = sellTax.toFixed(0); 

        return `<tr class="${highlightClass}"><td>${formattedSellPrice}</td><td class="${profitClass} ${profitColorClass}">${formattedProfitLoss}</td><td>${formattedTotalFees}</td><td>${formattedSellTax}</td></tr>`;
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
                const newPrice = lastResultPrice - (i * interval);
                newResults.unshift(calculateResult(newPrice));
            }
            allResults = newResults.concat(allResults);
        } else {
            lastResultPrice = parseFloat(allResults[allResults.length - 1].match(/<td>([\d.]+)<\/td>/)[1]);
            for (let i = 1; i <= 5; i++) {
                const newPrice = lastResultPrice + (i * interval);
                newResults.push(calculateResult(newPrice));
            }
            allResults = allResults.concat(newResults);
        }
        currentResultsCount += 5;
        displayResults();
    }

    // Set default values 
    $('#buyPrice').val(200);
    $('#buyShares').val(1); 
    $('#discount').val(2.8); 
    $('#strategy').val('long'); 
    $('#stockForm').submit();
});