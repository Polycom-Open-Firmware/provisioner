// SPDX-License-Identifier: GPL-2.0-or-later

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    provisioner_lib::run();
}
