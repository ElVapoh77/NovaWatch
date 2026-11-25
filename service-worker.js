
/* ==========================================================
   NOVAWATCH - Service Worker
   Version : 0.3

   Objectifs :
   - Mettre en cache les fichiers de l'application.
   - Permettre la consultation hors connexion.
   - Prioriser les actualités les plus récentes.
   - Supprimer les anciens caches.
   ========================================================== */

"use strict";


/* ==========================================================
   1. PARAMÈTRES DE CONFIGURATION
   ========================================================== */

// Version du cache.
// À modifier lors des futures mises à jour importantes.
const CACHE_VERSION = "v0.3.0";

// Préfixe permettant d'identifier les caches NovaWatch.
// Évite de supprimer les caches d'autres applications.
const CACHE_PREFIX = "novawatch-";

// Nom complet du cache utilisé par cette version.
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Liste des ressources indispensables à l'application.
// Les chemins relatifs permettent la compatibilité
// avec le sous-répertoire GitHub Pages /NovaWatch/.
const APP_FILES = [
    "./",
    "./index.html",
    "./assets/css/style.css",
    "./assets/js/app.js",
    "./data/articles.json",
    "./manifest.json"
];

// Délai maximal avant utilisation du cache.
// 5000 millisecondes = 5 secondes.
const NETWORK_TIMEOUT = 5000;


/* ==========================================================
   2. INSTALLATION DU SERVICE WORKER
   ========================================================== */

// L'événement install est déclenché lors de
// la première installation ou d'une mise à jour.

self.addEventListener("install", event => {

    console.info("[NovaWatch] Installation du Service Worker");

    // waitUntil() attend la fin de la mise en cache
    // avant de considérer l'installation comme réussie.
    event.waitUntil(

        // Ouvre ou crée le cache NovaWatch.
        caches.open(CACHE_NAME)

            .then(cache => {

                // addAll() télécharge et stocke
                // toutes les ressources de APP_FILES.
                return cache.addAll(APP_FILES);

            })

            .then(() => {

                // Active la nouvelle version du Service Worker
                // sans attendre la fermeture de tous les onglets.
                return self.skipWaiting();

            })
    );
});


/* ==========================================================
   3. ACTIVATION ET NETTOYAGE DES ANCIENS CACHES
   ========================================================== */

self.addEventListener("activate", event => {

    console.info("[NovaWatch] Activation du Service Worker");

    event.waitUntil(

        caches.keys()

            .then(cacheNames => {

                // Promise.all() attend la fin de toutes
                // les opérations de suppression.
                return Promise.all(

                    cacheNames

                        // Sélectionne uniquement les anciens
                        // caches appartenant à NovaWatch.
                        .filter(name =>

                            name.startsWith(CACHE_PREFIX) &&
                            name !== CACHE_NAME

                        )

                        // Supprime chaque ancien cache.
                        .map(name => caches.delete(name))
                );

            })

            .then(() => {

                // Prend immédiatement le contrôle
                // des pages NovaWatch déjà ouvertes.
                return self.clients.claim();

            })
    );
});


/* ==========================================================
   4. STRATÉGIE NETWORK FIRST
   ========================================================== */

/*
   Network First signifie :

   1. Essayer de récupérer la ressource sur Internet.
   2. Enregistrer la nouvelle version dans le cache.
   3. Utiliser le cache si Internet est indisponible.

   Paramètre request :
       Requête HTTP effectuée par le navigateur.

   Cette stratégie permet de privilégier les données
   récentes tout en conservant un mode hors connexion.
*/

async function networkFirst(request) {

    // Ouvre le cache de la version actuelle.
    const cache = await caches.open(CACHE_NAME);

    // Permet d'interrompre une requête trop longue.
    const controller = new AbortController();

    // Déclenche l'interruption après NETWORK_TIMEOUT.
    const timeout = setTimeout(

        () => controller.abort(),

        NETWORK_TIMEOUT
    );

    try {

        // no-store : évite de réutiliser une ancienne
        // réponse provenant du cache HTTP du navigateur.
        //
        // signal : permet l'interruption de la requête.

        const response = await fetch(request, {

            cache: "no-store",
            signal: controller.signal

        });

        // Une réponse HTTP incorrecte déclenche
        // l'utilisation du cache si disponible.
        if (!response.ok) {

            throw new Error(
                `Erreur HTTP ${response.status}`
            );
        }

        // clone() crée une copie de la réponse.
        // Une réponse HTTP ne peut être consommée
        // qu'une seule fois.
        //
        // Une copie est stockée dans le cache.
        // L'original est retourné au navigateur.

        await cache.put(
            request,
            response.clone()
        );

        return response;

    } catch (error) {

        console.warn(
            "[NovaWatch] Utilisation du cache",
            request.url
        );

        // Recherche une version déjà enregistrée.
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
            return cachedResponse;
        }

        // Si la page principale est demandée,
        // tente de retourner le HTML enregistré.
        if (request.mode === "navigate") {

            const fallback = await cache.match("./index.html");

            if (fallback) {
                return fallback;
            }
        }

        // Code HTTP 503 : service indisponible.
        // Aucune connexion et aucune ressource en cache.
        return new Response(
            "NovaWatch : ressource indisponible hors connexion.",
            {
                status: 503,
                headers: {
                    "Content-Type": "text/plain; charset=UTF-8"
                }
            }
        );

    } finally {

        // Supprime le minuteur après la requête.
        clearTimeout(timeout);
    }
}


/* ==========================================================
   5. INTERCEPTION DES REQUÊTES HTTP
   ========================================================== */

self.addEventListener("fetch", event => {

    const request = event.request;

    // GET : méthode HTTP utilisée pour lire une ressource.
    // Les autres méthodes ne sont pas mises en cache.
    if (request.method !== "GET") {
        return;
    }

    // Analyse l'adresse de destination.
    const url = new URL(request.url);

    // Ne traite pas les requêtes vers des sites externes.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Vérifie que la ressource appartient au périmètre
    // de notre application NovaWatch.
    const scope = new URL(self.registration.scope);

    if (!url.pathname.startsWith(scope.pathname)) {
        return;
    }

    // Intercepte uniquement les fichiers nécessaires
    // à l'application et les navigations internes.
    const isAppFile = APP_FILES.some(file =>

        new URL(
            file,
            self.registration.scope
        ).pathname === url.pathname

    );

    if (
        !isAppFile &&
        request.mode !== "navigate"
    ) {
        return;
    }

    // respondWith() remplace la réponse HTTP normale
    // par le résultat de notre stratégie Network First.
    event.respondWith(
        networkFirst(request)
    );
});


/* ==========================================================
   FIN DU SERVICE WORKER NOVAWATCH

   Big Brother never sleeps.
   ========================================================== */
