{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    rust-overlay,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [(import rust-overlay)];
        };
        nodejs = pkgs.nodejs_latest;
        pnpm = pkgs.pnpm.override {nodejs-slim = pkgs.nodejs-slim_latest;};
        package = builtins.fromJSON (builtins.readFile ./package.json);
        wasm = builtins.fromTOML (builtins.readFile ./wasm/Cargo.toml);
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          targets = ["wasm32-unknown-unknown"];
          extensions = ["rust-src" "rustfmt" "clippy" "rust-analyzer"];
        };
      in {
        devShells.default =
          assert pkgs.lib.assertMsg (pkgs.lib.trim (builtins.readFile ./.node-version) == nodejs.version)
            ".node-version must match the Nix Node.js version";
          assert pkgs.lib.assertMsg (package.packageManager == "pnpm@${pnpm.version}")
            "packageManager must match the Nix pnpm version";
          assert pkgs.lib.assertMsg (wasm.dependencies.wasm-bindgen == "=${pkgs.wasm-bindgen-cli.version}")
            "wasm-bindgen must match the Nix wasm-bindgen-cli version";
          pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              rustToolchain
              pkgs.cargo-audit
              pkgs.wasm-bindgen-cli
              pkgs.binaryen
            ];
          };
      }
    );
}
