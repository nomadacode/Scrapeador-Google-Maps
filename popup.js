document.addEventListener('DOMContentLoaded', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        var currentTab = tabs[0];
        var actionButton = document.getElementById('actionButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');
        var filenameInput = document.getElementById('filenameInput');
        var statusMessage = document.getElementById('statusMessage');

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
            actionButton.disabled = true;
            downloadCsvButton.disabled = true;
            statusMessage.textContent = 'Cargando resultados...';

            while (resultsTable.firstChild) {
                resultsTable.removeChild(resultsTable.firstChild);
            }

            chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: scrapeData
            }, function(results) {
                actionButton.disabled = false;
                actionButton.classList.add('enabled');

                if (chrome.runtime.lastError || !results || !results[0] || !Array.isArray(results[0].result)) {
                    statusMessage.textContent = 'Error al obtener resultados.';
                    return;
                }

                var finalResults = dedupeResults(results[0].result);

                var headers = ['Title', 'Rating', 'Reviews', 'Phone', 'Industry', 'Address', 'Website', 'Google Maps Link'];
                var headerRow = document.createElement('tr');
                headers.forEach(function(headerText) {
                    var header = document.createElement('th');
                    header.textContent = headerText;
                    headerRow.appendChild(header);
                });
                resultsTable.appendChild(headerRow);

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

                statusMessage.textContent = finalResults.length + ' resultados encontrados';
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

async function scrapeData() {
    function formatReviewCount(value) {
        var text = (value || '').toString().trim();
        return text.replace(/[()]/g, '');
    }

    function safeText(node) {
        return node && node.textContent ? node.textContent.trim() : '';
    }

    function extractContainer(link) {
        if (!link) return null;
        return (
            link.closest('[jsaction*="mouseover:pane"]') ||
            link.closest('div.Nv2PK') ||
            link.closest('[role="article"]') ||
            link.parentElement
        );
    }

    function extractTitle(container) {
        if (!container) return '';

        var selectorCandidates = [
            '.fontHeadlineSmall',
            '.qBF1Pd',
            '[role="heading"]',
            'h3',
            'h2'
        ];

        for (var i = 0; i < selectorCandidates.length; i++) {
            var title = safeText(container.querySelector(selectorCandidates[i]));
            if (title) return title;
        }

        var fallbackText = safeText(container);
        return fallbackText.split(/\n|\r|·/)[0].trim();
    }

    function extractInfoText(container) {
        if (!container) return '';

        var selectorCandidates = ['.W4Efsd', '.W4Efsd span', '.UaQhfb', '.W4Efsd:last-child', '.W4Efsd > span'];
        for (var i = 0; i < selectorCandidates.length; i++) {
            var nodes = Array.from(container.querySelectorAll(selectorCandidates[i]));
            var combined = nodes.map(safeText).filter(Boolean).join(' · ').trim();
            if (combined) return combined;
        }

        return safeText(container);
    }

    function extractRatingAndReviews(container) {
        if (!container) return { rating: '', reviewCount: '' };

        var roleImgContainer = container.querySelector('[role="img"][aria-label*="star"], [role="img"][aria-label*="Star"], [role="img"][aria-label*="estrella"], [role="img"]');
        var ariaLabel = roleImgContainer ? (roleImgContainer.getAttribute('aria-label') || '') : '';
        var text = (ariaLabel || '') + ' ' + safeText(container);
        var rating = '';
        var reviewCount = '';

        var ratingMatch = text.match(/([0-5][.,]\d)/);
        if (ratingMatch) {
            rating = ratingMatch[1];
        }

        var reviewPatterns = [
            /\(([\d.,]+)\)/,
            /([\d.,]+)\s*(reviews?|reseñas?)/i,
            /([\d.,]+)\s*(ratings?|calificaciones?)/i
        ];

        for (var i = 0; i < reviewPatterns.length; i++) {
            var reviewMatch = text.match(reviewPatterns[i]);
            if (reviewMatch && reviewMatch[1]) {
                reviewCount = formatReviewCount(reviewMatch[1]);
                break;
            }
        }

        return { rating: rating, reviewCount: reviewCount };
    }

    function extractPhone(container, infoText) {
        var phoneSources = [
            safeText(container && container.querySelector('button[data-item-id^="phone:"]')),
            safeText(container && container.querySelector('[data-item-id*="phone"]')),
            infoText,
            safeText(container)
        ];
        var phoneRegex = /(\+?\d{1,2}[\s.-])?\(?\d{2,3}\)?[\s.-]?\d{2,4}[\s.-]?\d{4}/;

        for (var i = 0; i < phoneSources.length; i++) {
            var source = phoneSources[i] || '';
            var phoneMatch = source.match(phoneRegex);
            if (phoneMatch) return phoneMatch[0];
        }
        return '';
    }

    function extractAddress(container, infoText) {
        var selectorAddress = safeText(container && container.querySelector('button[data-item-id^="address:"]'));
        if (!selectorAddress) {
            selectorAddress = safeText(container && container.querySelector('[data-item-id*="address"]'));
        }
        if (selectorAddress) return selectorAddress;

        var text = (infoText || '') + ' ' + safeText(container);
        var phoneRegex = /(\+?\d{1,2}[\s.-])?\(?\d{2,3}\)?[\s.-]?\d{2,4}[\s.-]?\d{4}/;
        var addressRegex = /\d+\s+[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9\s.,#-]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
        var match = text.match(addressRegex);
        if (!match) return '';

        var candidate = match[0]
            .replace(/\b(Closed|Cerrado|Open 24 hours|Abierto 24 horas|24 horas?|24 hours?)\b/gi, '')
            .replace(/\b(Open|Abierto)\b/g, '')
            .replace(/(\d+)(Open|Abierto|Closed|Cerrado)/g, '$1')
            .trim();

        if (phoneRegex.test(candidate) && !/[a-zA-ZÀ-ÿ]{3,}/.test(candidate)) return '';
        return candidate;
    }

    function extractWebsite(container, mapsUrl) {
        var links = Array.from((container && container.querySelectorAll('a[href]')) || []);
        var filtered = links.filter(function(anchor) {
            if (!anchor.href || anchor.href === mapsUrl) return false;
            if (anchor.href.startsWith('https://www.google.com/maps')) return false;
            return anchor.href.startsWith('http://') || anchor.href.startsWith('https://');
        });
        return filtered[0] ? filtered[0].href : '';
    }

    function extractCategory(container, rating, reviewCount, address, infoText) {
        var selectorCategory = safeText(container && container.querySelector('button[jsaction*="pane.rating.category"]'));
        if (selectorCategory) return selectorCategory;

        var text = (infoText || '') + ' ' + safeText(container);
        if (!text) return '';
        var normalizedReviews = formatReviewCount(reviewCount);
        var textBeforeAddress = address && text.includes(address) ? text.substring(0, text.indexOf(address)).trim() : text;
        var marker = (rating + normalizedReviews).trim();
        var markerIndex = marker ? textBeforeAddress.lastIndexOf(marker) : -1;
        if (markerIndex !== -1) {
            var raw = textBeforeAddress
                .substring(markerIndex + marker.length)
                .trim()
                .split(/[\r\n]+/)[0] || '';
            var cleanedRaw = raw.replace(/[·.,#!?]/g, '').trim();
            if (cleanedRaw) return cleanedRaw;
        }

        var segments = textBeforeAddress.split('·').map(function(part) { return part.trim(); }).filter(Boolean);
        var phoneSegRegex = /(\+?\d{1,2}[\s.-])?\(?\d{2,3}\)?[\s.-]?\d{2,4}[\s.-]?\d{4}/;
        for (var i = 0; i < segments.length; i++) {
            var segment = segments[i];
            if (segment === rating) continue;
            if (rating && segment.trim().startsWith(rating)) continue;
            if (normalizedReviews && formatReviewCount(segment) === normalizedReviews) continue;
            if (normalizedReviews && segment.includes(normalizedReviews)) continue;
            if (/^(No hay opiniones|Sin rese[ñn]as|No reviews|Be the first)/i.test(segment)) continue;
            if (address && segment.includes(address)) continue;
            if (phoneSegRegex.test(segment)) continue;
            if (segment) return segment.replace(/[.,#!?]/g, '').trim();
        }
        return '';
    }

    function extractMapsUrl(link) {
        return (link && link.href) || '';
    }

    async function scrollFeedToEnd() {
        var MAX_ITERATIONS = 25;
        var SCROLL_WAIT_MS = 1500;
        var SCROLL_INCREMENT = 800;

        var feed = document.querySelector('div[role="feed"]') ||
                   document.querySelector('#QA0Szd') ||
                   document.querySelector('[aria-label*="Results for"]') ||
                   document.querySelector('[aria-label*="Resultados"]');
        if (!feed) return;

        function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

        function isEndOfResults() {
            var endEl = document.querySelector('.HlvSq');
            if (endEl && endEl.offsetParent !== null) return true;
            var phrases = ["You've reached the end", 'llegaste al final'];
            return phrases.some(function(p) { return (feed.textContent || '').includes(p); });
        }

        var previousScrollHeight = -1;
        var stableCount = 0;

        for (var i = 0; i < MAX_ITERATIONS; i++) {
            if (isEndOfResults()) break;
            var currentHeight = feed.scrollHeight;
            if (currentHeight === previousScrollHeight) {
                if (++stableCount >= 2) break;
            } else {
                stableCount = 0;
            }
            previousScrollHeight = currentHeight;
            feed.scrollTop += SCROLL_INCREMENT;
            await sleep(SCROLL_WAIT_MS);
        }
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

    try { await scrollFeedToEnd(); }
    catch (e) { console.warn('Google Maps scraper: scroll failed, scraping current state', e); }

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
    var csvWithBom = '﻿' + csv;
    var csvFile = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
    var downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
