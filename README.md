# OFDM Radar Lab

An interactive, in-browser lab for learning wireless communication and
integrated sensing and communication (ISAC). Each slider re-runs a real
simulation (FFT, filters, noise, multipath, 2-D FFT radar processing).

## Labs

1. **Signals & Bandwidth**: time vs frequency, spectra, band-limiting, Nyquist rate.
2. **Modulation & Transmission**: bits → QAM → RRC pulse shaping → carrier → noise → matched filter → decision. Eye diagram, constellation, BER vs theory, Shannon limit.
3. **Channel**: link budget (path loss, kTB noise, capacity vs bandwidth), multipath (delay spread, coherence bandwidth, ISI), mobility (Doppler, Rayleigh/Rician fading).
4. **OFDM**: subcarrier orthogonality, numerology Δf, cyclic prefix, resource grid, pilot LS channel estimation, PAPR, BER/EVM.
5. **OFDM Radar (ISAC)**: range-Doppler map from the comms signal; resolution and ambiguity limits; CP-limited range; reciprocal vs matched-filter data removal; Doppler ICI.
6. **Antenna Arrays**: beamforming, beamwidth, sidelobes, tapering, grating lobes, two-user interference.
7. **Cooperative ISAC localisation**: several monostatic OFDM radar base stations (range, angle, Doppler per station) fused in two stages (range-angle map fusion, then weighted least squares). Position CRLB, GDOP, cooperation gain, velocity-vector fusion, and a Monte Carlo sweep of RMSE vs number of stations. Core in `src/dsp/coop.ts`.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Code layout

- `src/dsp/`: signal-processing core (FFT, RNG, modulation, filters, channel profiles, units).
- `src/components/`: canvas plots (line, heatmap, polar) and UI controls.
- `src/labs/`: one file per lab.

## Simplifications

Educational models, not standards-compliant link simulators. The radar lab
uses point targets, ideal self-interference cancellation and no clutter or
phase noise. CP overflow and Doppler ICI are modelled approximately. The
cooperative lab assumes the stations do not interfere with each other, ideal
full-duplex operation, multi-monostatic sensing only (no bistatic sync errors),
point objects, and greedy nearest-neighbour association.
