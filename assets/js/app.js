
/* ==========================================================
   NOVAWATCH - Moteur JavaScript
   Version : 0.2

   Objectifs :
   - Charger les articles collectés par Python.
   - Actualiser les statistiques.
   - Gérer les recherches et les filtres.
   - Afficher dynamiquement les articles.
   - Enregistrer les favoris dans le navigateur.
   - Gérer les erreurs de chargement.
   ========================================================== */


// Active le mode strict de JavaScript.
// Permet de détecter certaines erreurs de programmation.
"use strict";


/* ==========================================================
   1. PARAMÈTRES DE CONFIGURATION
   ========================================================== */

const CONFIG = {

    // Chemin relatif vers les articles collectés par Python.
    // Compatible avec l'hébergement GitHub Pages.
    DATA_URL: "data/articles.json",

    // Nombre d'articles affichés à chaque page.
    ARTICLES_PER_PAGE: 24,

    // Nombre maximal de caractères dans un résumé.
    SUMMARY_MAX_LENGTH: 350,

    // Délai maximal de chargement des données.
    // JavaScript utilise des millisecondes.
    // 15000 ms = 15 secondes.
    REQUEST_TIMEOUT: 15000,

    // Intervalle d'actualisation automatique de l'interface.
    // 300000 ms = 5 minutes.
    //
    // Ne déclenche pas le collecteur Python.
    // Recharge uniquement les données publiées sur GitHub.
    REFRESH_INTERVAL: 300000,

    // Nom de la clé utilisée dans le stockage du navigateur.
    STORAGE_KEY: "novawatch_favorites",

    // Langue utilisée pour l'affichage des dates.
    LOCALE: "fr-FR"
};


/* ==========================================================
   2. ÉTAT DE L'APPLICATION
   ========================================================== */

/*
   const empêche la réattribution de la variable STATE,
   mais autorise la modification de ses propriétés.

   Cet objet centralise l'état actuel de NovaWatch.
*/

const STATE = {

    // Liste complète des articles récupérés.
    articles: [],

    // Liste des identifiants des articles favoris.
    // Set permet de stocker des valeurs uniques.
    favorites: new Set(),

    // Rubrique actuellement sélectionnée.
    currentView: "all",

    // Nombre maximal d'articles actuellement affichés.
    visibleCount: CONFIG.ARTICLES_PER_PAGE,

    // Indique si une récupération est déjà en cours.
    isLoading: false,

    // Indique si un chargement a déjà réussi.
    hasLoaded: false
};


/* ==========================================================
   3. RÉCUPÉRATION DES ÉLÉMENTS HTML
   ========================================================== */

/*
   document.getElementById() récupère un élément HTML
   à partir de son attribut id.

   Ces identifiants correspondent à notre index.html.

   document.querySelectorAll() récupère tous les éléments
   correspondant au sélecteur CSS indiqué.
*/

const DOM = {

    // Indicateurs d'état.
    systemStatus: document.getElementById("system-status"),
    statusText: document.getElementById("status-text"),

    // Compteurs du tableau de bord.
    totalArticles: document.getElementById("total-articles"),
    totalAlerts: document.getElementById("total-alerts"),
    totalSources: document.getElementById("total-sources"),
    totalFavorites: document.getElementById("total-favorites"),

    // Recherche et filtres.
    searchInput: document.getElementById("search-input"),
    sourceFilter: document.getElementById("source-filter"),
    categoryFilter: document.getElementById("category-filter"),
    languageFilter: document.getElementById("language-filter"),

    // Boutons.
    refreshButton: document.getElementById("refresh-button"),
    loadMore: document.getElementById("load-more"),
    navButtons: document.querySelectorAll(".nav-button"),

    // Zone d'affichage des articles.
    articlesContainer: document.getElementById("articles-container"),
    feedTitle: document.getElementById("feed-title"),
    resultCount: document.getElementById("result-count"),

    // Informations du pied de page.
    lastUpdate: document.getElementById("last-update")
};


/* ==========================================================
   4. FONCTIONS UTILITAIRES
   ========================================================== */

/**
 * Crée un élément HTML de manière sécurisée.
 *
 * Paramètres :
 *   tag       : type d'élément HTML (div, p, h3...).
 *   className : classe CSS facultative.
 *   text      : contenu textuel facultatif.
 *
 * Retour :
 *   HTMLElement : élément HTML créé.
 */

function createElement(tag, className = "", text = "") {

    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    /*
       textContent insère uniquement du texte.

       Contrairement à innerHTML, il n'interprète pas
       les balises HTML ou le JavaScript provenant
       des sources RSS externes.
    */
    element.textContent = text;

    return element;
}


/**
 * Nettoie un texte provenant d'un flux RSS.
 *
 * Paramètre :
 *   value : texte pouvant contenir des balises HTML.
 *
 * Retour :
 *   Chaîne de caractères destinée à l'affichage.
 */

function cleanText(value) {

    // String() garantit une conversion en texte.
    // ?? utilise une chaîne vide si value est null
    // ou undefined.
    const text = String(value ?? "");

    return text

        // Supprime les balises HTML courantes.
        .replace(/<[^>]*>/g, " ")

        // Convertit quelques entités HTML fréquentes.
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")

        // Remplace les espaces multiples par un seul.
        .replace(/\s+/g, " ")

        // Supprime les espaces en début et fin de texte.
        .trim();
}


/**
 * Normalise un texte pour faciliter les recherches.
 *
 * Paramètre :
 *   value : texte à normaliser.
 *
 * Exemple :
 *   "Cybersécurité" devient "cybersecurite".
 */

function normalizeText(value) {

    return cleanText(value)

        // Décompose les caractères accentués.
        .normalize("NFD")

        // Supprime les marques d'accentuation.
        .replace(/[\u0300-\u036f]/g, "")

        // Convertit le texte en minuscules.
        .toLowerCase();
}


/**
 * Vérifie qu'une adresse URL est autorisée.
 *
 * Paramètre :
 *   value : adresse à contrôler.
 *
 * Retour :
 *   URL valide ou null.
 */

function validateURL(value) {

    try {

        const url = new URL(value);

        /*
           Seuls les protocoles HTTP et HTTPS sont autorisés.

           Cette vérification bloque notamment les liens
           javascript: et data: provenant des flux externes.

           Elle ne garantit pas que le site distant est fiable.
        */

        if (
            (url.protocol === "https:" ||
             url.protocol === "http:") &&
            !url.username &&
            !url.password
        ) {
            return url.href;
        }

    } catch (error) {

        // Une adresse incorrecte est simplement ignorée.
        console.warn("URL invalide :", value);
    }

    return null;
}


/**
 * Convertit une date au format français.
 *
 * Paramètre :
 *   value : date ISO provenant du fichier JSON.
 *
 * Retour :
 *   Date lisible par l'utilisateur.
 */

function formatDate(value) {

    if (!value) {
        return "Date inconnue";
    }

    const date = new Date(value);

    // getTime() retourne NaN lorsque la date est invalide.
    if (Number.isNaN(date.getTime())) {
        return "Date inconnue";
    }

    /*
       Intl.DateTimeFormat adapte automatiquement
       la date à la langue et au fuseau du navigateur.
    */

    return new Intl.DateTimeFormat(CONFIG.LOCALE, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}


/* ==========================================================
   5. GESTION DE L'ÉTAT DU SYSTÈME
   ========================================================== */

/**
 * Modifie l'indicateur d'état situé dans l'en-tête.
 *
 * Paramètre status :
 *   online  : données chargées.
 *   offline : erreur de récupération.
 *   loading : chargement en cours.
 *
 * Paramètre message :
 *   texte affiché à côté du voyant.
 */

function setStatus(status, message) {

    // Supprime les anciennes classes CSS d'état.
    DOM.systemStatus.classList.remove(
        "online",
        "offline",
        "loading"
    );

    // Applique la nouvelle classe CSS.
    DOM.systemStatus.classList.add(status);

    // Actualise le texte de l'indicateur.
    DOM.statusText.textContent = message;
}


/* ==========================================================
   6. GESTION DES FAVORIS
   ========================================================== */

/**
 * Charge les favoris enregistrés dans le navigateur.
 *
 * localStorage conserve les données même après
 * la fermeture du navigateur.
 *
 * Les données restent propres au navigateur utilisé.
 */

function loadFavorites() {

    try {

        const stored = localStorage.getItem(
            CONFIG.STORAGE_KEY
        );

        if (stored) {

            // JSON.parse() transforme le texte JSON
            // en tableau JavaScript.
            const parsed = JSON.parse(stored);

            if (Array.isArray(parsed)) {

                STATE.favorites = new Set(
                    parsed.filter(id => typeof id === "string")
                );
            }
        }

    } catch (error) {

        console.warn(
            "Impossible de charger les favoris.",
            error
        );

        STATE.favorites = new Set();
    }
}


/**
 * Enregistre les favoris dans le navigateur.
 */

function saveFavorites() {

    try {

        /*
           localStorage accepte uniquement du texte.

           Array.from() convertit le Set en tableau.
           JSON.stringify() convertit le tableau en JSON.
        */

        localStorage.setItem(
            CONFIG.STORAGE_KEY,
            JSON.stringify(
                Array.from(STATE.favorites)
            )
        );

        return true;

    } catch (error) {

        console.warn(
            "Impossible d'enregistrer les favoris.",
            error
        );

        return false;
    }
}


/**
 * Ajoute ou retire un article des favoris.
 *
 * Paramètre :
 *   articleId : identifiant SHA-256 de l'article,
 *               généré par notre collecteur Python.
 */

function toggleFavorite(articleId) {

    // has() vérifie si une valeur existe dans le Set.
    if (STATE.favorites.has(articleId)) {

        // Supprime un favori existant.
        STATE.favorites.delete(articleId);

    } else {

        // Ajoute un nouveau favori.
        STATE.favorites.add(articleId);
    }

    const saved = saveFavorites();

    updateDashboard();
    renderArticles();

    if (!saved) {
        DOM.resultCount.textContent +=
            " — Favoris non enregistrés durablement.";
    }
}


/* ==========================================================
   7. CHARGEMENT DES ARTICLES JSON
   ========================================================== */

/*
   async déclare une fonction asynchrone.

   await attend le résultat d'une opération asynchrone
   sans bloquer entièrement l'interface du navigateur.
*/

async function loadArticles() {

    // Empêche deux chargements simultanés.
    if (STATE.isLoading) {
        return;
    }

    STATE.isLoading = true;

    DOM.refreshButton.disabled = true;

    setStatus("loading", "SYNCHRONISATION");

    /*
       AbortController permet d'interrompre une requête.

       setTimeout() exécute une fonction après
       le délai défini dans notre configuration.
    */

    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        CONFIG.REQUEST_TIMEOUT
    );

    try {

        /*
           fetch() effectue une requête HTTP.

           cache: "no-store"
               Demande au navigateur de ne pas réutiliser
               une ancienne réponse de son cache HTTP.

           signal:
               Permet à AbortController d'interrompre
               la requête en cas de délai dépassé.
        */

        const response = await fetch(
            CONFIG.DATA_URL,
            {
                cache: "no-store",
                signal: controller.signal
            }
        );

        // response.ok est vrai pour un statut HTTP 2xx.
        if (!response.ok) {

            throw new Error(
                `Erreur HTTP ${response.status}`
            );
        }

        // Conversion du contenu JSON en objet JavaScript.
        const data = await response.json();

        // Vérifie que le fichier contient bien un tableau.
        if (!Array.isArray(data)) {

            throw new Error(
                "Format du fichier JSON incorrect."
            );
        }

        /*
           filter() conserve uniquement les articles
           possédant les propriétés essentielles.

           Cette vérification évite certaines erreurs
           si le fichier JSON contient des données invalides.
        */

        STATE.articles = data.filter(article =>

            article !== null &&
            typeof article === "object" &&
            typeof article.id === "string" &&
            typeof article.title === "string" &&
            typeof article.source === "string" &&
            typeof article.category === "string" &&
            validateURL(article.link) !== null
        );

        STATE.hasLoaded = true;

        // Actualisation des différents éléments.
        populateFilters();
        updateDashboard();
        updateLastUpdate();
        renderArticles();

        setStatus("online", "DONNÉES DISPONIBLES");

        console.info(
            `NovaWatch : ${STATE.articles.length} articles chargés.`
        );

    } catch (error) {

        console.error(
            "Erreur de chargement NovaWatch :",
            error
        );

        setStatus("offline", "ERREUR DE SYNCHRO");

        /*
           Si un chargement précédent a réussi,
           les anciens articles restent disponibles.

           Sinon, affiche un message d'erreur.
        */

        if (!STATE.hasLoaded) {

            showMessage(
                "Impossible de charger les articles. " +
                "Vérifie la disponibilité de data/articles.json.",
                "error-message"
            );

            DOM.resultCount.textContent =
                "Chargement impossible.";

        } else {

            DOM.resultCount.textContent =
                "Synchronisation échouée — données précédentes conservées.";
        }

    } finally {

        // Annule le minuteur devenu inutile.
        clearTimeout(timeout);

        // Réactive le bouton après succès ou échec.
        STATE.isLoading = false;
        DOM.refreshButton.disabled = false;
    }
}


/* ==========================================================
   8. TABLEAU DE BORD
   ========================================================== */

/**
 * Détermine si un article appartient aux alertes.
 *
 * Paramètre :
 *   article : objet contenant les données de l'article.
 *
 * Retour :
 *   true ou false.
 */

function isAlert(article) {

    return normalizeText(article.category) === "alertes";
}


/**
 * Actualise les quatre compteurs du tableau de bord.
 */

function updateDashboard() {

    // Nombre total d'articles disponibles.
    DOM.totalArticles.textContent =
        STATE.articles.length;

    // Nombre d'articles appartenant à la catégorie Alertes.
    DOM.totalAlerts.textContent =
        STATE.articles.filter(isAlert).length;

    /*
       map() extrait le nom de chaque source.

       Set supprime les valeurs identiques.
       size retourne le nombre de sources différentes.
    */

    const sources = new Set(
        STATE.articles.map(article => article.source)
    );

    DOM.totalSources.textContent = sources.size;

    // Compte les favoris encore présents dans le flux.
    DOM.totalFavorites.textContent =
        STATE.articles.filter(article =>
            STATE.favorites.has(article.id)
        ).length;
}


/* ==========================================================
   9. DATE DE DERNIÈRE COLLECTE CONNUE
   ========================================================== */

function updateLastUpdate() {

    /*
       On utilise collected_at et non published.

       published    : date de publication de l'article.
       collected_at : date de récupération par NovaWatch.
    */

    const dates = STATE.articles

        .map(article =>
            new Date(article.collected_at).getTime()
        )

        .filter(date => Number.isFinite(date));

    if (dates.length === 0) {

        DOM.lastUpdate.textContent =
            "Dernier article collecté : date inconnue";

        return;
    }

    // Math.max() récupère la valeur la plus récente.
    const latestDate = Math.max(...dates);

    DOM.lastUpdate.textContent =
        `Dernier article collecté : ${formatDate(latestDate)}`;
}


/* ==========================================================
   10. GÉNÉRATION DES FILTRES
   ========================================================== */

/**
 * Remplit une liste déroulante avec des valeurs uniques.
 *
 * Paramètres :
 *   select       : élément HTML de type select.
 *   values       : tableau des valeurs disponibles.
 *   defaultLabel : texte de l'option générale.
 */

function populateSelect(select, values, defaultLabel) {

    // Conserve la sélection actuelle de l'utilisateur.
    const previousValue = select.value;

    // Supprime les anciennes options.
    select.replaceChildren();

    const defaultOption = createElement(
        "option",
        "",
        defaultLabel
    );

    defaultOption.value = "all";

    select.append(defaultOption);

    // Élimination des doublons et tri alphabétique.
    const uniqueValues = [...new Set(values)]

        .filter(value => typeof value === "string" && value)

        .sort((a, b) =>
            a.localeCompare(b, CONFIG.LOCALE)
        );

    // Création dynamique de chaque option.
    for (const value of uniqueValues) {

        const option = createElement(
            "option",
            "",
            value
        );

        option.value = value;

        select.append(option);
    }

    // Restaure le filtre précédent s'il existe toujours.
    select.value = uniqueValues.includes(previousValue)
        ? previousValue
        : "all";
}


/**
 * Initialise les listes des sources et catégories.
 */

function populateFilters() {

    populateSelect(

        DOM.sourceFilter,

        STATE.articles.map(article => article.source),

        "Toutes les sources"
    );

    populateSelect(

        DOM.categoryFilter,

        STATE.articles.map(article => article.category),

        "Toutes les catégories"
    );
}


/* ==========================================================
   11. GESTION DES RUBRIQUES
   ========================================================== */

/**
 * Vérifie si un article correspond à la rubrique active.
 *
 * Paramètre :
 *   article : objet contenant les informations de l'article.
 *
 * Retour :
 *   true si l'article doit être affiché.
 */

function matchesView(article) {

    const category = normalizeText(article.category);

    switch (STATE.currentView) {

        // Sentinel : cybersécurité et alertes.
        case "security":

            return (
                category.includes("cybersecurite") ||
                isAlert(article)
            );

        /*
           Pour le moment, IT-Connect utilise une catégorie
           commune "Systèmes et réseaux".

           Un même article peut donc apparaître dans
           les rubriques Network et System.
        */

        case "network":

            return category.includes("reseau");

        case "system":

            return category.includes("systeme");

        // Archives : uniquement les favoris.
        case "favorites":

            return STATE.favorites.has(article.id);

        // Radar : tous les articles.
        case "all":
        default:

            return true;
    }
}


/**
 * Modifie le titre en fonction de la rubrique active.
 */

function updateViewTitle() {

    const titles = {

        all: "Radar technologique",
        security: "Sentinel — Cybersécurité",
        network: "Network — Réseaux",
        system: "System — Systèmes",
        favorites: "Archives — Favoris"
    };

    DOM.feedTitle.textContent =
        titles[STATE.currentView] ?? titles.all;
}


/* ==========================================================
   12. MOTEUR DE RECHERCHE ET DE FILTRAGE
   ========================================================== */

function getFilteredArticles() {

    const search = normalizeText(DOM.searchInput.value);

    const source = DOM.sourceFilter.value;

    const category = DOM.categoryFilter.value;

    const language = DOM.languageFilter.value;

    /*
       split() sépare la recherche en plusieurs mots.

       Exemple :
       "Cisco sécurité" devient ["cisco", "securite"].

       Chaque mot devra être présent dans l'article,
       sans nécessairement respecter leur ordre.
    */

    const searchTerms = search
        .split(/\s+/)
        .filter(Boolean);

    return STATE.articles.filter(article => {

        // Vérification de la rubrique.
        if (!matchesView(article)) {
            return false;
        }

        // Vérification de la source.
        if (
            source !== "all" &&
            article.source !== source
        ) {
            return false;
        }

        // Vérification de la catégorie.
        if (
            category !== "all" &&
            article.category !== category
        ) {
            return false;
        }

        // Vérification de la langue.
        if (
            language !== "all" &&
            article.language !== language
        ) {
            return false;
        }

        // Regroupe les informations disponibles.
        const searchableText = normalizeText(
            [
                article.title,
                article.summary,
                article.source,
                article.category
            ].join(" ")
        );

        /*
           every() vérifie que chaque mot recherché
           est présent dans le texte de l'article.
        */

        return searchTerms.every(
            term => searchableText.includes(term)
        );
    });
}


/* ==========================================================
   13. COULEURS DES ARTICLES
   ========================================================== */

/**
 * Sélectionne une classe CSS selon la catégorie.
 *
 * Paramètre :
 *   article : article à personnaliser.
 *
 * Retour :
 *   Nom d'une classe définie dans style.css.
 */

function getCategoryClass(article) {

    const category = normalizeText(article.category);

    if (isAlert(article)) {
        return "alert";
    }

    if (category.includes("cybersecurite")) {
        return "security";
    }

    if (category.includes("reseau")) {
        return "network";
    }

    if (category.includes("systeme")) {
        return "system";
    }

    return "";
}


/* ==========================================================
   14. CRÉATION D'UNE CARTE ARTICLE
   ========================================================== */

/**
 * Génère la structure HTML d'un article.
 *
 * Paramètre :
 *   article : dictionnaire provenant du fichier JSON.
 *
 * Retour :
 *   HTMLElement : carte complète de l'article.
 */

function createArticleCard(article) {

    // Création du conteneur principal.
    const card = createElement(
        "article",
        "article-card"
    );

    // Ajout de la couleur correspondant à la catégorie.
    const categoryClass = getCategoryClass(article);

    if (categoryClass) {
        card.classList.add(categoryClass);
    }


    // ------------------------------------------------------
    // En-tête : source et date
    // ------------------------------------------------------

    const header = createElement(
        "div",
        "article-header"
    );

    const source = createElement(
        "span",
        "article-source",
        article.source
    );

    const date = createElement(
        "span",
        "article-date",
        formatDate(
            article.published || article.collected_at
        )
    );

    header.append(source, date);


    // ------------------------------------------------------
    // Titre
    // ------------------------------------------------------

    const title = createElement(
        "h3",
        "article-title",
        cleanText(article.title)
    );


    // ------------------------------------------------------
    // Résumé
    // ------------------------------------------------------

    let summaryText = cleanText(article.summary);

    /*
       slice(début, fin) extrait une partie du texte.

       On limite la taille des résumés afin de conserver
       une interface homogène.
    */

    if (summaryText.length > CONFIG.SUMMARY_MAX_LENGTH) {

        summaryText = summaryText.slice(
            0,
            CONFIG.SUMMARY_MAX_LENGTH
        ) + "…";
    }

    const summary = createElement(

        "p",

        "article-summary",

        summaryText || "Aucun résumé disponible."
    );


    // ------------------------------------------------------
    // Étiquettes de catégorie et de langue
    // ------------------------------------------------------

    const tags = createElement(
        "div",
        "article-tags"
    );

    const categoryTag = createElement(
        "span",
        "article-tag",
        article.category
    );

    const languageTag = createElement(
        "span",
        "article-tag",
        String(article.language ?? "inconnue").toUpperCase()
    );

    tags.append(categoryTag, languageTag);


    // ------------------------------------------------------
    // Pied de carte
    // ------------------------------------------------------

    const footer = createElement(
        "div",
        "article-footer"
    );

    // Création du lien vers la source originale.
    const link = createElement(
        "a",
        "article-link",
        "Consulter l'article ↗"
    );

    // Validation du lien avant son insertion.
    const safeURL = validateURL(article.link);

    if (safeURL) {

        link.href = safeURL;

        // Ouvre l'article dans un nouvel onglet.
        link.target = "_blank";

        /*
           noopener :
               empêche la page distante d'accéder
               à la fenêtre ayant ouvert le lien.

           noreferrer :
               évite de transmettre l'adresse
               de la page NovaWatch au site distant.
        */

        link.rel = "noopener noreferrer";

        footer.append(link);
    }


    // ------------------------------------------------------
    // Bouton favori
    // ------------------------------------------------------

    const isFavorite = STATE.favorites.has(article.id);

    const favoriteButton = createElement(

        "button",

        "favorite-button",

        isFavorite ? "★" : "☆"
    );

    favoriteButton.type = "button";

    // Applique la couleur violette aux favoris.
    favoriteButton.classList.toggle(
        "active",
        isFavorite
    );

    const favoriteLabel = isFavorite
        ? "Retirer des favoris"
        : "Ajouter aux favoris";

    favoriteButton.title = favoriteLabel;

    // Attributs d'accessibilité.
    favoriteButton.setAttribute(
        "aria-label",
        favoriteLabel
    );

    favoriteButton.setAttribute(
        "aria-pressed",
        String(isFavorite)
    );

    /*
       addEventListener() associe une action
       à un événement du navigateur.

       "click" correspond au clic sur le bouton.
    */

    favoriteButton.addEventListener(
        "click",
        () => toggleFavorite(article.id)
    );

    footer.append(favoriteButton);


    // Assemblage de tous les éléments de la carte.
    card.append(
        header,
        title,
        summary,
        tags,
        footer
    );

    return card;
}


/* ==========================================================
   15. MESSAGES DE L'INTERFACE
   ========================================================== */

/**
 * Affiche un message à la place des articles.
 *
 * Paramètres :
 *   message   : texte à afficher.
 *   className : classe CSS du message.
 */

function showMessage(message, className) {

    const element = createElement(
        "div",
        className,
        message
    );

    DOM.articlesContainer.replaceChildren(element);

    DOM.loadMore.hidden = true;
}


/* ==========================================================
   16. AFFICHAGE DES ARTICLES
   ========================================================== */

function renderArticles() {

    updateViewTitle();

    // Évite de remplacer le message initial de chargement.
    if (!STATE.hasLoaded) {
        return;
    }

    // Récupération des articles correspondant aux filtres.
    const filtered = getFilteredArticles();

    /*
       slice(0, visibleCount) limite le nombre
       de cartes affichées simultanément.
    */

    const visible = filtered.slice(
        0,
        STATE.visibleCount
    );

    // Actualisation du compteur de résultats.
    DOM.resultCount.textContent =
        `${visible.length} / ${filtered.length} articles affichés`;

    // Gestion de l'absence de résultats.
    if (filtered.length === 0) {

        const message = STATE.currentView === "favorites"

            ? "Aucun article favori correspondant aux filtres."

            : "Aucun article correspondant aux critères.";

        showMessage(message, "empty-message");

        return;
    }

    /*
       DocumentFragment est un conteneur temporaire.

       Il permet de préparer plusieurs éléments HTML
       avant de les insérer ensemble dans la page.
    */

    const fragment = document.createDocumentFragment();

    for (const article of visible) {

        fragment.append(
            createArticleCard(article)
        );
    }

    // Remplace les anciennes cartes par les nouvelles.
    DOM.articlesContainer.replaceChildren(fragment);

    /*
       Le bouton de pagination est masqué lorsque
       tous les articles correspondants sont affichés.
    */

    DOM.loadMore.hidden =
        visible.length >= filtered.length;
}


/* ==========================================================
   17. RÉINITIALISATION DE LA PAGINATION
   ========================================================== */

function resetPagination() {

    STATE.visibleCount = CONFIG.ARTICLES_PER_PAGE;

    renderArticles();
}


/* ==========================================================
   18. GESTION DES ÉVÉNEMENTS
   ========================================================== */

function bindEvents() {

    // Actualise les résultats pendant la saisie.
    DOM.searchInput.addEventListener(
        "input",
        resetPagination
    );

    // Actualise les résultats après changement de filtre.
    DOM.sourceFilter.addEventListener(
        "change",
        resetPagination
    );

    DOM.categoryFilter.addEventListener(
        "change",
        resetPagination
    );

    DOM.languageFilter.addEventListener(
        "change",
        resetPagination
    );


    // ------------------------------------------------------
    // Navigation entre les rubriques
    // ------------------------------------------------------

    for (const button of DOM.navButtons) {

        button.setAttribute(
            "aria-pressed",
            String(button.classList.contains("active"))
        );

        button.addEventListener("click", () => {

            /*
               dataset.view récupère la valeur
               de l'attribut HTML data-view.
            */

            STATE.currentView = button.dataset.view;

            // Désactive les anciennes rubriques.
            for (const navButton of DOM.navButtons) {

                navButton.classList.remove("active");

                navButton.setAttribute(
                    "aria-pressed",
                    "false"
                );
            }

            // Active la rubrique sélectionnée.
            button.classList.add("active");

            button.setAttribute(
                "aria-pressed",
                "true"
            );

            // Réinitialise les filtres lors du changement
            // de rubrique pour éviter les filtres incompatibles.
            DOM.searchInput.value = "";
            DOM.sourceFilter.value = "all";
            DOM.categoryFilter.value = "all";
            DOM.languageFilter.value = "all";

            resetPagination();
        });
    }


    // ------------------------------------------------------
    // Actualisation manuelle
    // ------------------------------------------------------

    DOM.refreshButton.addEventListener(
        "click",
        loadArticles
    );


    // ------------------------------------------------------
    // Pagination
    // ------------------------------------------------------

    DOM.loadMore.addEventListener("click", () => {

        // Ajoute 24 articles à la limite actuelle.
        STATE.visibleCount += CONFIG.ARTICLES_PER_PAGE;

        renderArticles();
    });


    // ------------------------------------------------------
    // Actualisation automatique
    // ------------------------------------------------------

    /*
       setInterval() exécute une fonction à intervalles
       réguliers tant que la page est active.

       document.hidden permet d'éviter les requêtes
       inutiles lorsque l'onglet n'est pas visible.
    */

    setInterval(() => {

        if (!document.hidden) {
            loadArticles();
        }

    }, CONFIG.REFRESH_INTERVAL);


    // Actualise les données au retour sur l'application.

    document.addEventListener(
        "visibilitychange",
        () => {

            if (!document.hidden) {
                loadArticles();
            }
        }
    );


    // Actualise les favoris modifiés dans un autre onglet.

    window.addEventListener("storage", event => {

        if (
            event.key === CONFIG.STORAGE_KEY ||
            event.key === null
        ) {

            STATE.favorites = new Set();

            loadFavorites();
            updateDashboard();
            renderArticles();
        }
    });
}


/* ==========================================================
   19. INITIALISATION DE NOVAWATCH
   ========================================================== */

function init() {

    console.info(
        "=== INITIALISATION NOVAWATCH v0.2 ==="
    );

    // Charge les favoris précédemment enregistrés.
    loadFavorites();

    // Initialise les événements de l'interface.
    bindEvents();

    // Lance la première récupération des articles.
    loadArticles();
}


/*
   Notre script est chargé avec l'attribut defer
   dans index.html.

   Le document HTML est donc déjà disponible
   lorsque cette fonction est exécutée.
*/

init();


/* ==========================================================
   FIN DU MOTEUR JAVASCRIPT NOVAWATCH

   Nous surveillons l'actualité.
   Absolument rien d'autre.
   ========================================================== */

/* ==========================================================
   20. ENREGISTREMENT DU SERVICE WORKER
   ========================================================== */

// Vérifie que le navigateur prend en charge
// les Service Workers avant de tenter l'installation.

if ("serviceWorker" in navigator) {

    // Attend le chargement complet de la page.
    window.addEventListener("load", async () => {

        try {

            // register() installe le Service Worker.
            //
            // scope: "./" limite son périmètre
            // au répertoire de NovaWatch.

            const registration =
                await navigator.serviceWorker.register(
                    "./service-worker.js",
                    {
                        scope: "./"
                    }
                );

            console.info(
                "[NovaWatch] Service Worker enregistré :",
                registration.scope
            );

        } catch (error) {

            // L'application reste utilisable même
            // si le Service Worker ne peut pas être installé.

            console.error(
                "[NovaWatch] Erreur Service Worker :",
                error
            );
        }
    });
}

