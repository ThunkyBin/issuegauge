"""Compatibility for genlayer-test's immediate stdin-file unlink on Windows."""

import os
import sys
import tempfile
from unittest.mock import patch


if sys.platform == "win32":
    from gltest.direct import loader as direct_loader
    from gltest.direct.vm import VMContext

    _inject_message_to_fd0 = direct_loader._inject_message_to_fd0
    _cleanup_after_deactivate = VMContext._cleanup_after_deactivate

    def _inject_message_to_fd0_windows(vm):
        created_paths = []
        create_temp_file = tempfile.mkstemp
        unlink = os.unlink

        def capture_temp_file(*args, **kwargs):
            descriptor, path = create_temp_file(*args, **kwargs)
            created_paths.append(path)
            return descriptor, path

        def defer_stdin_unlink(path, *args, **kwargs):
            if path in created_paths:
                vm._gltest_stdin_temp_path = path
                return None
            return unlink(path, *args, **kwargs)

        with patch("tempfile.mkstemp", capture_temp_file), patch("os.unlink", defer_stdin_unlink):
            _inject_message_to_fd0(vm)

    def _cleanup_after_deactivate_windows(vm):
        try:
            _cleanup_after_deactivate(vm)
        finally:
            path = getattr(vm, "_gltest_stdin_temp_path", None)
            if path:
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass
                delattr(vm, "_gltest_stdin_temp_path")

    direct_loader._inject_message_to_fd0 = _inject_message_to_fd0_windows
    VMContext._cleanup_after_deactivate = _cleanup_after_deactivate_windows
