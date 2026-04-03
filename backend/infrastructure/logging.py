import logging
import os

LOG_FILE_PATH = "/var/log/webserver/logfile.log"
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def _build_handler():
    formatter = logging.Formatter(LOG_FORMAT)
    try:
        os.makedirs(os.path.dirname(LOG_FILE_PATH), exist_ok=True)
        handler = logging.FileHandler(LOG_FILE_PATH)
    except OSError:
        handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    return handler


backend_logger = logging.getLogger("backend_logger")
backend_logger.setLevel(logging.INFO)
backend_logger.propagate = False

if not backend_logger.handlers:
    backend_logger.addHandler(_build_handler())
