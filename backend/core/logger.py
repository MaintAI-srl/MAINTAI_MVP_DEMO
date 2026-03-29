import logging
import os
from datetime import datetime

# Assicuriamoci che la cartella logs esista
LOG_DIR = os.path.join(os.getcwd(), "logs")
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

LOG_FILE = os.path.join(LOG_DIR, "maintai.log")

def setup_logger():
    logger = logging.getLogger("maintai")
    logger.setLevel(logging.INFO)
    
    # Formattazione
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # File Handler
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(formatter)
    
    # Stream Handler (per vedere i log anche in console)
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    
    if not logger.handlers:
        logger.addHandler(file_handler)
        logger.addHandler(stream_handler)
        
    return logger

# Singleton istance
logger = setup_logger()

def log_error(message: str, exc: Exception = None):
    if exc:
        logger.error(f"{message} | EXC: {str(exc)}")
    else:
        logger.error(message)

def log_info(message: str):
    logger.info(message)
