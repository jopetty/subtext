#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import http.server
import os
from pathlib import Path


class SpaRequestHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.exists(path):
            return super().send_head()

        index_path = self.translate_path('/index.html')
        if os.path.exists(index_path):
            self.path = '/index.html'
            return super().send_head()

        return super().send_head()


def main() -> None:
    parser = argparse.ArgumentParser(description='Serve a static SPA with index fallback.')
    parser.add_argument('port', nargs='?', type=int, default=8080)
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--directory', default='.')
    args = parser.parse_args()

    directory = Path(args.directory).resolve()
    handler = functools.partial(SpaRequestHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((args.bind, args.port), handler)

    print(f'Serving Subtext at http://{args.bind}:{args.port} from {directory}')
    server.serve_forever()


if __name__ == '__main__':
    main()
