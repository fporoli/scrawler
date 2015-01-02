var fs = require("node-fs"),
    url = require( "url" ),
    Crawler = require("simplecrawler").Crawler,
    mongoose = require("mongoose"),
    request = require("request"),
    xmldom = require("xmldom");

mongoose.connect("mongodb://localhost:27017/dbbootshop");

var db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function callback() {
    console.log("Connected to Mongo DB");
});

var productSchema = mongoose.Schema({
    id: { type: String, unique: true },
    name: String,
    url: String,
    urlDetail: String,
    urlDetailSpec: String,
    category: String,
    subCategory: String,
    subSubCategory: String,
    imgSmall: String,
    imgMedium: String,
    imgLarge: String,
    pricefixed: 0.0,
    pricevariable: false,
    pricetag: String,
    isNewProduct: false,
    brand: String,
    title: String,
    shortDescription: String,
    longDescription: String,
    dataartname: String,
    pdf: String,
    urlPrice: String
});

// id,name,url,urlDetail,urlDetailSpec,category,subCategory,subSubCategory,imgSmall,imgMedium,imgLarge,pricefixed,
// pricevariable,pricetag,isNewProduct,brand,title,shortDescription,longDescription,dataartname,pdf,urlPrice

var Product = mongoose.model("Product", productSchema);
Product.collection.drop();

function stringToByteArray(str) {
    var b = [], i, unicode;
    for (i = 0; i < str.length; i++) {
        unicode = str.charCodeAt(i);
        // 0x00000000 - 0x0000007f -> 0xxxxxxx
        if (unicode <= 0x7f) {
            b.push(String.fromCharCode(unicode));
            // 0x00000080 - 0x000007ff -> 110xxxxx 10xxxxxx
        } else if (unicode <= 0x7ff) {
            b.push(String.fromCharCode((unicode >> 6) | 0xc0));
            b.push(String.fromCharCode((unicode & 0x3F) | 0x80));
            // 0x00000800 - 0x0000ffff -> 1110xxxx 10xxxxxx 10xxxxxx
        } else if (unicode <= 0xffff) {
            b.push(String.fromCharCode((unicode >> 12) | 0xe0));
            b.push(String.fromCharCode(((unicode >> 6) & 0x3f) | 0x80));
            b.push(String.fromCharCode((unicode & 0x3f) | 0x80));
            // 0x00010000 - 0x001fffff -> 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
        } else {
            b.push(String.fromCharCode((unicode >> 18) | 0xf0));
            b.push(String.fromCharCode(((unicode >> 12) & 0x3f) | 0x80));
            b.push(String.fromCharCode(((unicode >> 6) & 0x3f) | 0x80));
            b.push(String.fromCharCode((unicode & 0x3f) | 0x80));
        }
    }
    return b;
}

function takeInnerHtml(str) {
    if (str && str.trim().indexOf("<a href=") === 0) {
        var idx = str.indexOf(">") + 1;
        return str.substr(idx, str.indexOf("<", idx) - idx);
    }
    return str;
}

function normalizeString(str) {
    if (str) {
        return str
            .replace(/&amp;auml;/g, "ä")
            .replace(/&auml;/g, "ä")
            .replace(/&amp;uuml;/g, "ü")
            .replace(/&uuml;/g, "ü")
            .replace(/&amp;ouml;/g, "ä")
            .replace(/&ouml;/g, "ö")
    }
    return "";
}

function findProductInfos(htmlDoc, prod, prodWithCategory) {
    if (htmlDoc.getElementById("content")) {
        var divElements = htmlDoc.getElementById("content").getElementsByTagName("div");
        for (var divElementIter = 0; divElementIter < divElements.length; divElementIter++) {
            var divElem = divElements[divElementIter];
            if (divElem.hasAttribute("class") && divElem.getAttribute("class").indexOf("breadcrumb_big cat") >= 0) {
                var pElem = divElem.getElementsByTagName("p");
                if (pElem.length == 3) {
                    var tmp = pElem[0].getElementsByTagName("span");
                    prod.category = tmp && tmp.length > 0 && tmp[0] && tmp[0].firstChild ? normalizeString(tmp[0].firstChild.toString()) : "";
                    tmp = pElem[1].getElementsByTagName("span");
                    prod.subCategory = tmp && tmp.length > 0 && tmp[0] && tmp[0].firstChild ? normalizeString(takeInnerHtml(tmp[0].firstChild.toString())) : "";
                    tmp = pElem[2].getElementsByTagName("span");
                    prod.subSubCategory = tmp && tmp.length > 0 && tmp[0] && tmp[0].firstChild ? normalizeString(tmp[0].firstChild.toString()) : "";
                    console.log(">>>>>>>>> " + prod.category + " # " + prod.subCategory + " # " + prod.subSubCategory);
                    prodWithCategory.category = prod.category;
                    prodWithCategory.subCategory = prod.subCategory;
                    prodWithCategory.subSubCategory = prod.subSubCategory;
                }
            }
        }
    }
    return { divElements: divElements, divElementIter: divElementIter, divElem: divElem, pElem: pElem, tmp: tmp };
}

function extractTextElements(td, prod) {
    if (td[1].hasAttribute("class") && td[1].getAttribute("class") === "text") {
        var d = td[1].getElementsByTagName("div");
        for (var j = 0; j < d.length; j++) {
            var divElement = d[j];
            if (divElement.hasAttribute("class") && divElement.getAttribute("class") === "mrq") {
                if (divElement.firstChild) {
                    prod.brand = divElement.firstChild.toString();
                } else {
                    prod.brand = "---";
                }
                console.log("..... Marke: " + prod.brand);
            }
            if (divElement.hasAttribute("class") && divElement.getAttribute("class") === "desc") {
                var aElement = divElement.getElementsByTagName("a");
                prod.title = aElement[0].firstChild.toString();
                console.log("..... Titel:" + prod.title);
                if (aElement[1].firstChild) {
                    var bValue = aElement[1].firstChild.toString();
                    prod.shortDescription = normalizeString(bValue);
                } else {
                    prod.shortDescription = "---"
                }
                console.log("..... Beschreibung:" + prod.shortDescription);
            }
            if (divElement.hasAttribute("class") && divElement.getAttribute("class") === "bt") {
                var priceElement = divElement.getElementsByTagName("span");
                for (var priceElementIterator = 0; priceElementIterator < priceElement.length; priceElementIterator++) {
                    var pe = priceElement[priceElementIterator];
                    if (pe && pe.hasAttribute("class") && pe.getAttribute("class") === "prix") {
                        var price = parseFloat(pe.firstChild.toString());
                        if (isNaN(price) && price && price.length > 0) {
                            prod.pricetag = pe.firstChild.toString();
                            console.log("..... Preis/Tag:" + prod.pricetag);

                        } else {
                            prod.pricefixed = price;
                            console.log("..... Preis:" + prod.pricefixed);
                        }
                    } else if (pe && pe.hasAttribute("class") && pe.getAttribute("class") === "id") {
                        prod.pricetag = pe.firstChild.toString();
                        console.log("..... Preis-Id:" + prod.pricetag);
                    }
                }
            }
        }
    }
}
function extractImgElements(td, prod) {
    if (td[0].hasAttribute("class") && td[0].getAttribute("class") === "pic") {
        var im = td[0].getElementsByTagName("img");
        if (im && im.length > 0 && im[0].hasAttribute("src")) {
            prod.imgSmall = im[0].getAttribute("src");
            console.log("..... img:" + im[0].getAttribute("src"));
        }
        var a = td[0].getElementsByTagName("a");
        if (a && a.length > 0 && a[0].hasAttribute("href")) {
            prod.urlDetail = a[0].getAttribute("href");
            console.log("..... href:" + prod.urlDetail);
        }
        var isNewDiv = td[0].getElementsByTagName("div");
        prod.isNewProduct = false;
        for (var j = 0; j < isNewDiv.length; j++) {
            if (isNewDiv[j] && isNewDiv[j].hasAttribute("class") && isNewDiv[j].getAttribute("class") === "new_icon") {
                prod.isNewProduct = true;
            }
        }
    }
}
function extractAndPersistProductInformations(prod, prodWithCategory, htmlDoc, e, domain) {
// We have a new product.
    if (!prod.subSubCategory) {
        // Find the category
        findProductInfos(htmlDoc, prod, prodWithCategory);
    }
    prod.id = e.getAttribute("id");
    prod.dataartname = e.getAttribute("data-art-name");
    console.log("...... Id:" + prod.id + " # data-art-name:" + prod.dataartname);
    var td = e.getElementsByTagName("td");
    extractImgElements(td, prod);
    extractTextElements(td, prod);

    request("http://" + domain + "/" + prod.urlDetail + "/1", function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var htmlDetailsDoc = (new xmldom.DOMParser()).parseFromString(body);
            var el = htmlDetailsDoc.getElementById("details");
            if (el && el.hasChildNodes()) {
                var divs = el.getElementsByTagName("div");
                if (divs && divs.length >= 1 && divs[1].hasAttribute("class") && divs[1].getAttribute("class") === "img") {
                    var uls = divs[1].getElementsByTagName("ul");
                    if (uls.length > 0 && uls[0].hasAttribute("class") && uls[0].getAttribute("class") === "img_medium") {
                        prod.imgMedium = uls[0].getElementsByTagName("img")[0].getAttribute("src");
                    }
                } else {
                    console.log("No img details in " + el.toString());
                }
                if (divs.length > 2 && divs[2].hasAttribute("class") && divs[2].getAttribute("class") === "text") {
                    var subDivs = divs[2].getElementsByTagName("div");
                    for (var j = 0; j < subDivs.length; j++) {
                        if (subDivs[j].hasAttribute("class") && subDivs[j].getAttribute("class") === "icon pdf") {
                            prod.pdf = subDivs[j].getElementsByTagName("a")[0].getAttribute("href");
                        } else if (subDivs[j].hasAttribute("class") && subDivs[j].getAttribute("class") === "section desc") {
                            var ssDiv = subDivs[j].getElementsByTagName("div");
                            for (var k = 0; k < ssDiv.length; k++) {
                                if (ssDiv[k].hasAttribute("itemprop") && ssDiv[k].getAttribute("itemprop") === "description") {
                                    prod.longDescription = normalizeString(ssDiv[k].childNodes[1].toString());
                                }
                            }
                        } else if (subDivs[j].hasAttribute("class") && subDivs[j].getAttribute("class") === "section prix") {
                            var ssDiv = subDivs[j].getElementsByTagName("div");
                            for (var k = 0; k < ssDiv.length; k++) {
                                if (ssDiv[k].hasAttribute("class") && ssDiv[k].getAttribute("class") === "metas") {
                                    prod.urlPrice = ssDiv[k].getElementsByTagName("a")[0].getAttribute("data-backurl");
                                }
                            }
                        }
                    }
                }

                prod.save(function(err, fluffy) {
                    console.log("Product saved.");
                    if (err) {
                        console.error(err);
                    }
                });
            }
        }
    });
    return prod;
}

function cleanupHtml(htmlDoc) {
    var removeIds = [ "top", "menu1_#3_main", "main_cat#13", "footer", "promo", "drawer", "r_bgmask", "search_filter" ];
    removeIds.forEach(function(r) {
        if (r.indexOf("#") >= 0) {
            var maxVal = parseInt(r.substr(r.indexOf("#") + 1));
            for (var i = 1; i <= maxVal; i++) {
                var s = r.replace("#" + maxVal.toString(), i.toString())
                var el = htmlDoc.getElementById(s);
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }
        } else {
            var el = htmlDoc.getElementById(r);
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }
    });
}

/**
 * @param String. Domain to download.
 * @Param Function. Callback when crawl is complete.
 */
var downloadSite = function(domain, callback) {

    // Where to save downloaded data
    var outputDirectory = __dirname + "/" + domain;
    var myCrawler = new Crawler(domain);
    myCrawler.interval = 250;
    myCrawler.maxConcurrency = 5;
    myCrawler.addFetchCondition(function(parsedUrl) {
        return parsedUrl.path.indexOf("/fr/") < 0;
    });

    myCrawler.on("fetchcomplete", function(queueItem, responseBuffer, response) {

        // Parse url
        var parsed = url.parse(queueItem.url)

        // Rename / to index.html
        if (parsed.pathname === "/") {
            parsed.pathname = "/index.html";
        }

        // Get directory name in order to create any nested dirs
        var dirname = outputDirectory + parsed.pathname.replace(/\/[^\/]+$/, "");

        // Path to save file
        var filepath = outputDirectory + parsed.pathname;

        if (response.headers["content-type"] === "text/html; charset=UTF-8") {
            var htmlDoc = (new xmldom.DOMParser()).parseFromString(responseBuffer.toString(), "text/html");
            //ids to remove:
            cleanupHtml(htmlDoc);
            var el = htmlDoc.getElementById("top");
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
            responseBuffer = htmlDoc.toString();

            // Add a .html at the end of the file name if not specified
            if (filepath.indexOf(".html") < 0) {
                filepath = filepath + ".html";
            }
            if (htmlDoc.toString().indexOf("<body class=\"catalog details de \">")) {
                console.log(".. Das ist ein Katalog Item");
                el = htmlDoc.getElementById("t_results");
                if (el && el.hasChildNodes()) {
                    var tr = el.getElementsByTagName("tr");
                    var prodWithCategory = new Product();
                    for (var i = 0; i < tr.length; i++) {
                        var prod = new Product();
                        prod.url = queueItem.url;
                        if (prodWithCategory.category) {
                            prod.category = prodWithCategory.category;
                            prod.subCategory = prodWithCategory.subCategory;
                            prod.subSubCategory = prodWithCategory.subSubCategory;
                        }
                        var e = tr[i];
                        if (e.tagName == "tr" && e.hasAttribute("data-art-name") && e.hasAttribute("id")) {
                            extractAndPersistProductInformations(prod, prodWithCategory, htmlDoc, e, domain);
                        }
                    }
                    console.log(".. Items: " + el.length);
                }
            }
        }

        if (response.headers["content-type"] !== "text/html; charset=UTF-8") {
            // For test purposes skip everything which is not html
            return;
        }

        // Check if DIR exists
        fs.exists(dirname, function(exists) {

            // If DIR exists, write file
            if (exists) {
                fs.writeFile(filepath, responseBuffer, function() {})
            // Else, recursively create dir using node-fs, then write file
            } else {
                fs.mkdir(dirname, 0755, true, function(err) {
                    fs.writeFile(filepath, responseBuffer, function() {
                    })
                });
            }
        });
        console.log("I just received %s (%d bytes)", queueItem.url, responseBuffer.length);
        console.log("It was a resource of type %s", response.headers["content-type"]);
    });

    // Fire callback
    myCrawler.on("complete", function() {
        callback();
    });
    
    // Start Crawl
    myCrawler.start();
}

downloadSite("www.bucher-walt.ch", function() {
    console.log("Done!");
});
