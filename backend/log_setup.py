import logging
import os

'''
Set up logging to a file in /var/log/webserver/logfile.log. 
Create the directory if it doesn't exist. 
Log all INFO level and above messages with timestamps.
The logfiles are watched by Ops Agent and sent to Cloud Logging for storage and view in log-explorer.
We can see which host handled which request, and also log custom messages for important events like request creation, bid submission, etc.
'''

LOG_FILE_PATH = "/var/log/webserver/logfile.log"

backend_logger = logging.getLogger("backend_logger")
backend_logger.setLevel(logging.INFO)
backend_logger.propagate = False

if not backend_logger.handlers:
    try:
        os.makedirs(os.path.dirname(LOG_FILE_PATH), exist_ok=True)
        file_handler = logging.FileHandler(LOG_FILE_PATH)
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
        backend_logger.addHandler(file_handler)
    except OSError:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
        backend_logger.addHandler(stream_handler)
