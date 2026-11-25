
# ============================================================
# NOVAWATCH - Collecteur de flux RSS
# Version : 0.1
#
# Objectifs :
# - Récupérer les articles depuis différentes sources RSS.
# - Identifier et supprimer les doublons.
# - Conserver un historique des articles.
# - Trier les articles par date de publication.
# - Gérer les erreurs de connexion.
# ============================================================


# ============================================================
# 1. IMPORTATION DES BIBLIOTHÈQUES
# ============================================================

import json       # Lecture et écriture des fichiers JSON.
import hashlib    # Génération d'empreintes cryptographiques.
import logging    # Gestion des journaux d'activité.
import calendar   # Conversion des dates en timestamps.

# Path permet de manipuler les chemins de fichiers
# indépendamment du système d'exploitation.
from pathlib import Path

# datetime permet de manipuler les dates et les heures.
# timezone permet de gérer les fuseaux horaires.
from datetime import datetime, timezone

# Bibliothèques externes installées via requirements.txt.
import feedparser  # Analyse des flux RSS et Atom.
import requests    # Envoi de requêtes HTTP et HTTPS.


# ============================================================
# 2. PARAMÈTRES DE CONFIGURATION
# ============================================================

# __file__ : chemin du script Python actuellement exécuté.
# resolve() : retourne son chemin absolu.
# parent : remonte d'un niveau dans l'arborescence.
#
# Premier parent : dossier scripts/
# Deuxième parent : dossier racine NovaWatch/
BASE_DIR = Path(__file__).resolve().parent.parent

# L'opérateur / permet d'assembler des chemins avec Path.
#
# Fichier contenant les différentes sources RSS.
SOURCES_FILE = BASE_DIR / "data" / "sources.json"

# Fichier contenant les articles collectés.
# Il sera automatiquement créé lors de la première collecte.
ARTICLES_FILE = BASE_DIR / "data" / "articles.json"

# Nombre maximal d'articles conservés dans le fichier JSON.
# Les articles les plus anciens seront supprimés lorsque
# cette limite sera dépassée.
MAX_ARTICLES = 1000

# Délai d'attente réseau exprimé en secondes.
# S'applique aux délais de connexion et de lecture HTTP.
# Ce n'est pas une limite globale de durée de téléchargement.
TIMEOUT = 20

# Fuseau horaire UTC (Coordinated Universal Time).
# Permet de normaliser les dates des différentes sources.
UTC = timezone.utc

# Identifiant envoyé aux serveurs web lors des requêtes.
# Permet aux serveurs d'identifier notre application.
USER_AGENT = "NovaWatch/0.1 RSS Reader"


# ============================================================
# 3. CONFIGURATION DES JOURNAUX (LOGS)
# ============================================================

# basicConfig() configure le système de journalisation.
#
# Paramètre level :
#   DEBUG    : informations détaillées de débogage.
#   INFO     : informations de fonctionnement normal.
#   WARNING  : avertissements non bloquants.
#   ERROR    : erreurs de fonctionnement.
#   CRITICAL : erreurs critiques.
#
# Paramètre format :
#   %(asctime)s   : date et heure de l'événement.
#   %(levelname)s : niveau de gravité.
#   %(message)s   : contenu du message.

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

# Création d'un journal nommé NovaWatch.
logger = logging.getLogger("NovaWatch")


# ============================================================
# 4. LECTURE DES FICHIERS JSON
# ============================================================

def load_json(path: Path, default):
    """
    Charge le contenu d'un fichier JSON.

    Paramètres :
        path (Path) : chemin du fichier à lire.
        default : valeur retournée si le fichier n'existe pas.

    Retour :
        Contenu du fichier JSON ou valeur par défaut.
    """

    # exists() vérifie si le chemin existe.
    # not inverse le résultat du test.
    if not path.exists():
        return default

    # open() ouvre le fichier.
    #
    # Paramètres :
    #   "r" : ouverture en mode lecture (read).
    #   encoding="utf-8" : encodage des caractères.
    #
    # with ferme automatiquement le fichier à la fin
    # du bloc, même si une exception se produit.
    #
    # as file : stocke le fichier ouvert dans la variable file.

    with path.open("r", encoding="utf-8") as file:

        # json.load() convertit le contenu JSON en objet Python.
        return json.load(file)


# ============================================================
# 5. ÉCRITURE DES FICHIERS JSON
# ============================================================

def save_json(path: Path, data) -> None:
    """
    Enregistre des données dans un fichier JSON.

    Paramètres :
        path (Path) : chemin du fichier de destination.
        data : données Python à enregistrer.

    Retour :
        None : la fonction ne retourne aucune valeur.
    """

    # mkdir() crée le dossier de destination.
    #
    # parents=True :
    #   crée également les dossiers parents manquants.
    #
    # exist_ok=True :
    #   ne déclenche pas d'erreur si le dossier existe déjà.

    path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    # with_suffix() remplace l'extension du fichier.
    #
    # Exemple :
    # articles.json devient articles.tmp.
    #
    # L'utilisation d'un fichier temporaire évite
    # d'écraser directement les anciennes données.

    temp_path = path.with_suffix(".tmp")

    # "w" : ouverture en mode écriture (write).
    # Attention : ce mode écrase le contenu existant
    # du fichier ouvert.

    with temp_path.open("w", encoding="utf-8") as file:

        # json.dump() convertit les données Python en JSON.
        #
        # data : données à enregistrer.
        # file : fichier de destination.
        #
        # ensure_ascii=False :
        #   conserve les accents et caractères Unicode.
        #
        # indent=4 :
        #   utilise quatre espaces pour l'indentation.

        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=4
        )

    # replace() remplace le fichier final par le temporaire.
    #
    # Cette méthode permet une écriture atomique lorsque
    # le système de fichiers prend en charge cette opération.
    # Elle limite les risques de corruption des données.

    temp_path.replace(path)


# ============================================================
# 6. GÉNÉRATION DES IDENTIFIANTS UNIQUES
# ============================================================

def generate_id(link: str) -> str:
    """
    Génère un identifiant à partir de l'URL d'un article.

    Paramètres :
        link (str) : URL de l'article.

    Retour :
        str : empreinte SHA-256 de 64 caractères hexadécimaux.

    SHA-256 :
        Secure Hash Algorithm 256 bits.
    """

    # encode("utf-8") :
    #   convertit la chaîne de caractères en octets.
    #
    # hashlib.sha256() :
    #   calcule une empreinte cryptographique de 256 bits.
    #
    # hexdigest() :
    #   convertit cette empreinte en chaîne hexadécimale.
    #
    # Une même URL produira toujours la même empreinte.
    # Cela permet de détecter les articles déjà enregistrés.

    return hashlib.sha256(
        link.encode("utf-8")
    ).hexdigest()


# ============================================================
# 7. TRAITEMENT DES DATES
# ============================================================

def get_date(entry) -> str | None:
    """
    Récupère la date de publication d'un article.

    Paramètres :
        entry : objet représentant un article RSS,
                fourni par la bibliothèque feedparser.

    Retour :
        str  : date au format ISO 8601.
        None : aucune date disponible.
    """

    # get() récupère la valeur associée à une clé.
    # Si la clé n'existe pas, retourne None.
    #
    # published_parsed : date de publication.
    # updated_parsed   : date de dernière modification.
    #
    # L'opérateur or permet d'utiliser la date de mise
    # à jour si la date de publication est indisponible.

    date = (
        entry.get("published_parsed")
        or entry.get("updated_parsed")
    )

    # Vérifie qu'une date a bien été récupérée.
    if date:

        # calendar.timegm() convertit la date en timestamp.
        #
        # Un timestamp représente le nombre de secondes
        # écoulées depuis le 1er janvier 1970 à 00:00:00 UTC.
        #
        # fromtimestamp() convertit ce nombre en date Python.
        #
        # tz=UTC : impose le fuseau horaire UTC.
        #
        # isoformat() : convertit la date au format ISO 8601.
        #
        # Exemple : 2026-11-25T20:30:00+00:00

        return datetime.fromtimestamp(
            calendar.timegm(date),
            tz=UTC
        ).isoformat()

    # Aucune date disponible.
    return None


# ============================================================
# 8. RÉCUPÉRATION D'UNE SOURCE RSS
# ============================================================

def fetch_source(source: dict) -> list:
    """
    Récupère les articles d'une source RSS.

    Paramètres :
        source (dict) : dictionnaire contenant :
            name     : nom de la source.
            url      : adresse du flux RSS.
            category : catégorie de veille.
            language : langue des articles.

    Retour :
        list : liste des articles récupérés.
    """

    # Initialisation d'une liste vide qui contiendra
    # les articles récupérés depuis cette source.
    articles = []

    # %s est un emplacement réservé à une chaîne.
    # logging remplacera %s par le nom de la source.
    logger.info("Collecte : %s", source["name"])

    # try permet d'exécuter un bloc susceptible
    # de déclencher une exception.
    try:

        # requests.get() envoie une requête HTTP GET.
        #
        # Premier argument : URL de destination.
        #
        # timeout=TIMEOUT :
        #   configure les délais d'attente réseau.
        #
        # headers :
        #   dictionnaire contenant les en-têtes HTTP.
        #
        # User-Agent :
        #   identifie notre application auprès du serveur.

        response = requests.get(
            source["url"],
            timeout=TIMEOUT,
            headers={
                "User-Agent": USER_AGENT
            }
        )

        # raise_for_status() déclenche une exception
        # si le serveur retourne une erreur HTTP.
        #
        # Exemples :
        #   403 : accès interdit.
        #   404 : ressource introuvable.
        #   500 : erreur interne du serveur.

        response.raise_for_status()

        # response.content contient la réponse HTTP
        # sous forme d'octets.
        #
        # feedparser.parse() analyse le flux XML
        # et extrait les articles ainsi que leurs métadonnées.
        #
        # XML : Extensible Markup Language.

        feed = feedparser.parse(response.content)

        # bozo indique que feedparser a détecté
        # une anomalie pendant l'analyse du flux.
        #
        # Un flux mal formé peut malgré tout contenir
        # des articles exploitables.

        if feed.bozo:

            logger.warning(
                "Flux potentiellement mal formé : %s",
                source["name"]
            )

        # feed.entries contient les articles du flux.
        #
        # La boucle for parcourt chaque article
        # et le stocke temporairement dans entry.

        for entry in feed.entries:

            # get("link", "") récupère l'URL de l'article.
            #
            # Si la clé link n'existe pas, retourne "".
            #
            # strip() supprime les espaces situés
            # au début et à la fin de la chaîne.

            link = entry.get("link", "").strip()

            # startswith() vérifie le début d'une chaîne.
            #
            # Le tuple contient les deux protocoles acceptés.
            #
            # continue interrompt l'itération actuelle
            # et passe directement à l'article suivant.
            #
            # Ce contrôle exclut notamment les liens
            # vides ou commençant par javascript:.
            # Il ne constitue pas une validation complète
            # de l'adresse URL.

            if not link.startswith(("https://", "http://")):
                continue

            # Création d'un dictionnaire contenant
            # les informations de l'article.

            article = {

                # Identifiant généré à partir de l'URL.
                "id": generate_id(link),

                # Titre fourni par le flux RSS.
                # Valeur par défaut si le titre est absent.
                "title": entry.get("title", "Sans titre"),

                # URL permettant de consulter l'article.
                "link": link,

                # Résumé fourni par la source RSS.
                # Peut contenir du HTML non fiable.
                "summary": entry.get("summary", ""),

                # Nom de la source de veille.
                "source": source["name"],

                # Catégorie définie dans sources.json.
                "category": source["category"],

                # Langue déclarée dans sources.json.
                # Valeur par défaut : français.
                "language": source.get("language", "fr"),

                # Date de publication normalisée.
                "published": get_date(entry),

                # Date de récupération par NovaWatch.
                #
                # now(UTC) récupère la date actuelle en UTC.
                # isoformat() la convertit en chaîne.
                "collected_at": datetime.now(
                    UTC
                ).isoformat()
            }

            # append() ajoute un élément à la fin d'une liste.
            articles.append(article)

        # len() retourne le nombre d'éléments d'une liste.
        # %d représente un nombre entier dans le journal.

        logger.info(
            "%s : %d articles récupérés",
            source["name"],
            len(articles)
        )

        # Retourne la liste complète des articles.
        return articles

    # except intercepte les exceptions réseau
    # générées par la bibliothèque requests.
    #
    # as error stocke les informations de l'exception
    # dans la variable error.
    #
    # Cela évite qu'une source inaccessible interrompe
    # l'ensemble de la collecte.

    except requests.RequestException as error:

        logger.error(
            "Erreur sur %s : %s",
            source["name"],
            error
        )

        # Retourne une liste vide en cas d'erreur réseau.
        return []


# ============================================================
# 9. FONCTION PRINCIPALE
# ============================================================

def main() -> None:
    """
    Fonction principale de NovaWatch.

    Elle coordonne les différentes étapes :
        1. Chargement des sources.
        2. Chargement des anciens articles.
        3. Collecte des nouveaux articles.
        4. Détection des doublons.
        5. Tri chronologique.
        6. Enregistrement des données.

    Retour :
        None.
    """

    logger.info("=== Démarrage de NovaWatch ===")

    # Chargement des sources RSS.
    # [] représente une liste vide utilisée par défaut
    # si le fichier n'existe pas.

    sources = load_json(SOURCES_FILE, [])

    # Chargement des articles des collectes précédentes.
    existing_articles = load_json(ARTICLES_FILE, [])

    # Création d'un dictionnaire par compréhension.
    #
    # Syntaxe :
    # {clé: valeur for élément in collection}
    #
    # La clé correspond à l'identifiant SHA-256.
    # La valeur correspond au dictionnaire de l'article.
    #
    # Cette structure facilite la recherche de doublons.

    articles = {
        article["id"]: article
        for article in existing_articles
    }

    # Compteur du nombre de nouveaux articles.
    new_count = 0

    # Compteur du nombre total d'articles récupérés
    # pendant cette collecte, doublons compris.
    fetched_count = 0

    # Parcours de toutes les sources de veille.
    for source in sources:

        # Appel de la fonction de récupération RSS.
        fetched_articles = fetch_source(source)

        # += additionne une valeur à la variable existante.
        fetched_count += len(fetched_articles)

        # Parcours des articles récupérés.
        for article in fetched_articles:

            # not in vérifie que l'identifiant n'est pas
            # déjà présent parmi les clés du dictionnaire.
            #
            # Si l'identifiant existe, l'article est ignoré.

            if article["id"] not in articles:

                # Ajout du nouvel article au dictionnaire.
                articles[article["id"]] = article

                # Incrémentation du compteur.
                new_count += 1

    # Si aucun article n'a été récupéré,
    # considère la collecte comme ayant échoué.

    if fetched_count == 0:

        logger.error("Aucun article récupéré.")

        # SystemExit(1) arrête le programme.
        #
        # Code de retour :
        #   0 : exécution réussie.
        #   1 : exécution en erreur.
        #
        # GitHub Actions utilisera ce code pour déterminer
        # si l'exécution du script a échoué.

        raise SystemExit(1)

    # sorted() trie les éléments d'une collection.
    #
    # articles.values() :
    #   récupère les articles sans leurs clés.
    #
    # key :
    #   indique le critère utilisé pour effectuer le tri.
    #
    # lambda :
    #   fonction anonyme utilisée ici pour retourner
    #   la date de publication de chaque article.
    #
    # Si la date de publication est absente,
    # la date de collecte sera utilisée.
    #
    # reverse=True :
    #   inverse l'ordre du tri pour afficher
    #   les articles les plus récents en premier.
    #
    # Les dates ISO 8601 étant normalisées en UTC,
    # leur tri textuel permet ici un tri chronologique.

    sorted_articles = sorted(
        articles.values(),
        key=lambda article: (
            article["published"]
            or article["collected_at"]
        ),
        reverse=True
    )

    # Découpage de la liste (slicing).
    #
    # Syntaxe : liste[début:fin]
    #
    # Un début absent signifie que l'on commence à l'index 0.
    # La borne de fin n'est pas incluse.
    #
    # [:MAX_ARTICLES] conserve uniquement les
    # 1000 premiers articles, donc les plus récents.

    sorted_articles = sorted_articles[:MAX_ARTICLES]

    # Enregistrement des articles dans articles.json.
    save_json(ARTICLES_FILE, sorted_articles)

    # Affichage du bilan de la collecte.
    logger.info(
        "Nouveaux articles : %d",
        new_count
    )

    logger.info(
        "Total enregistré : %d",
        len(sorted_articles)
    )

    logger.info("=== Collecte terminée ===")


# ============================================================
# 10. POINT D'ENTRÉE DU PROGRAMME
# ============================================================

# __name__ est une variable spéciale de Python.
#
# Si le fichier est exécuté directement :
#   __name__ vaut "__main__".
#
# Si le fichier est importé depuis un autre script :
#   __name__ correspond au nom du module.
#
# Cette condition permet d'exécuter main() uniquement
# lorsque fetch_rss.py est lancé directement.
#
# Elle permettra également d'importer nos fonctions
# dans de futurs scripts de tests sans lancer la collecte.

if __name__ == "__main__":
    main()
