document.addEventListener('DOMContentLoaded', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        var currentTab = tabs[0];
        var actionButton = document.getElementById('actionButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');
        var filenameInput = document.getElementById('filenameInput');

        if (currentTab && currentTab.url.includes('://www.google.com/maps/search')) {
            document.getElementById('message').textContent = 'Scrapeemos 😎!';
            actionButton.disabled = false;
            actionButton.classList.add('enabled');
        } else {
            var messageElement = document.getElementById('message');
            messageElement.innerHTML = '';
            var linkElement = document.createElement('a');
            linkElement.href = 'https://www.google.com/maps/search/';
            linkElement.textContent = 'Go to Google Maps Search.';
            linkElement.target = '_blank';
            messageElement.appendChild(linkElement);

            actionButton.style.display = 'none';
            downloadCsvButton.style.display = 'none';
            filenameInput.style.display = 'none';
        }

        actionButton.addEventListener('click', function() {
            chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: scrapeData
            }, function(results) {
                while (resultsTable.firstChild) {
                    resultsTable.removeChild(resultsTable.firstChild);
                }

                var headers = ['Title', 'Rating', 'Reviews', 'Phone', 'Industry', 'Address', 'Website', 'Google Maps Link'];
                var headerRow = document.createElement('tr');
                headers.forEach(function(headerText) {
                    var header = document.createElement('th');
                    header.textContent = headerText;
                    headerRow.appendChild(header);
                });
                resultsTable.appendChild(headerRow);

                if (!results || !results[0] || !Array.isArray(results[0].result)) return;

                var finalResults = dedupeResults(results[0].result);

                finalResults.forEach(function(item) {
                    var row = document.createElement('tr');
                    ['title', 'rating', 'reviewCount', 'phone', 'industry', 'address', 'companyUrl', 'href'].forEach(function(key) {
                        var cell = document.createElement('td');
                        var value = key === 'reviewCount' ? formatReviewCount(item[key]) : item[key];
                        cell.textContent = value || '';
                        row.appendChild(cell);
                    });
                    resultsTable.appendChild(row);
                });

                downloadCsvButton.disabled = finalResults.length === 0;
            });
        });

        downloadCsvButton.addEventListener('click', function() {
            var csv = tableToCsv(resultsTable);
            var filename = filenameInput.value.trim();
            if (!filename) {
                filename = 'google-maps-data.csv';
            } else {
                filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
            }
            downloadCsv(csv, filename);
        });
    });
});

function normalizeForKey(value) {
    return (value || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function isMeaningfulFallbackValue(value) {
    var normalized = normalizeForKey(value);
    return normalized.length > 2 && !['-', 'n/a', 'na', 'null', 'undefined'].includes(normalized);
}

function dedupeResults(items) {
    var seen = new Set();
    return (items || []).filter(function(item) {
        if (!item) return false;

        var mapsUrlKey = normalizeForKey(item.href);
        var hasMeaningfulFallback = isMeaningfulFallbackValue(item.title) && isMeaningfulFallbackValue(item.address);
        var fallbackKey = hasMeaningfulFallback
            ? normalizeForKey(item.title) + '|' + normalizeForKey(item.address)
            : '';
        var key = mapsUrlKey || fallbackKey;

        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function formatReviewCount(value) {
    var text = (value || '').toString().trim();
    return text.replace(/[()]/g, '');
}

function scrapeData() {
    function safeText(node) {
        return node && node.textContent ? node.textContent.trim() : '';
    }

    function extractContainer(link) {
        return link ? link.closest('[jsaction*="mouseover:pane"]') : null;
    }

    function extractTitle(container) {
        return safeText(container && container.querySelector('.fontHeadlineSmall'));
    }

    function extractInfoText(container) {
        if (!container) return '';

        var selectorCandidates = ['.W4Efsd', '.W4Efsd span', '.UaQhfb', '.W4Efsd:last-child'];
        for (var i = 0; i < selectorCandidates.length; i++) {
            var nodes = Array.from(container.querySelectorAll(selectorCandidates[i]));
            var combined = nodes.map(safeText).filter(Boolean).join(' · ').trim();
            if (combined) return combined;
        }

        return safeText(container);
    }

    function extractRatingAndReviews(container) {
        var roleImgContainer = container && container.querySelector('[role="img"]');
        var ariaLabel = roleImgContainer ? (roleImgContainer.getAttribute('aria-label') || '') : '';
        if (!ariaLabel) return { rating: '', reviewCount: '' };

        var numbers = ariaLabel.match(/\d+[\d.,]*/g) || [];
        return {
            rating: numbers[0] || '',
            reviewCount: formatReviewCount(numbers[1] || '')
        };
    }

    function extractPhone(container, infoText) {
        var phoneSources = [infoText, safeText(container && container.querySelector('button[data-item-id^="phone:"]'))];
        var phoneRegex = /(\+\d{1,2}\s)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

        for (var i = 0; i < phoneSources.length; i++) {
            var source = phoneSources[i] || '';
            var phoneMatch = source.match(phoneRegex);
            if (phoneMatch) return phoneMatch[0];
        }
        return '';
    }

    function extractAddress(container, infoText) {
        var selectorAddress = safeText(container && container.querySelector('button[data-item-id^="address:"]'));
        if (selectorAddress) return selectorAddress;

        var addressRegex = /\d+\s+[\w\s.,#-]+(?:Suite\s*\d+|Apt\s*\d+|#\s*\d+)?/;
        var match = (infoText || '').match(addressRegex);
        if (!match) return '';

        return match[0]
            .replace(/\b(Closed|Open 24 hours|24 hours)|Open\b/g, '')
            .replace(/(\d+)(Open)/g, '$1')
            .replace(/(\w)(Open|Closed)/g, '$1')
            .trim();
    }

    function extractWebsite(container, mapsUrl) {
        var links = Array.from((container && container.querySelectorAll('a[href]')) || []);
        var filtered = links.filter(function(anchor) {
            return anchor.href && anchor.href !== mapsUrl && !anchor.href.startsWith('https://www.google.com/maps/place/');
        });
        return filtered[0] ? filtered[0].href : '';
    }

    function extractCategory(container, rating, reviewCount, address, infoText) {
        var selectorCategory = safeText(container && container.querySelector('button[jsaction*="pane.rating.category"]'));
        if (selectorCategory) return selectorCategory;

        var text = infoText || '';
        if (!text) return '';

        var marker = [rating, formatReviewCount(reviewCount)].filter(Boolean).join(' ');
        if (marker && text.includes(marker)) {
            text = text.substring(text.indexOf(marker) + marker.length).trim();
        }

        if (address) {
            text = text.replace(address, '').trim();
        }

        var firstSegment = text.split('·')[0] || '';
        return firstSegment.replace(/[.,#!?]/g, '').trim();
    }

    function extractMapsUrl(link) {
        return (link && link.href) || '';
    }

    function buildResult(link) {
        try {
            var container = extractContainer(link);
            var href = extractMapsUrl(link);
            var infoText = extractInfoText(container);
            var ratingData = extractRatingAndReviews(container);
            var address = extractAddress(container, infoText);

            return {
                title: extractTitle(container),
                rating: ratingData.rating,
                reviewCount: formatReviewCount(ratingData.reviewCount),
                phone: extractPhone(container, infoText),
                industry: extractCategory(container, ratingData.rating, ratingData.reviewCount, address, infoText),
                address: address,
                companyUrl: extractWebsite(container, href),
                href: href
            };
        } catch (error) {
            console.warn('Google Maps scrape: failed to build result for a node', error);
            return {
                title: '',
                rating: '',
                reviewCount: '',
                phone: '',
                industry: '',
                address: '',
                companyUrl: '',
                href: extractMapsUrl(link)
            };
        }
    }

    var links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
    return links.map(buildResult);
}

function escapeCsvCell(value) {
    var text = value == null ? '' : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
}

function tableToCsv(table) {
    var csv = [];
    var rows = table.querySelectorAll('tr');

    for (var i = 0; i < rows.length; i++) {
        var row = [];
        var cols = rows[i].querySelectorAll('td, th');

        for (var j = 0; j < cols.length; j++) {
            row.push(escapeCsvCell(cols[j].innerText));
        }
        csv.push(row.join(','));
    }

    return csv.join('\r\n');
}

function downloadCsv(csv, filename) {
    var csvWithBom = '\uFEFF' + csv;
    var csvFile = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
    var downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
