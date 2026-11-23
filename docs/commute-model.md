# Morning commute simulation

The game uses a broad morning preference, not a measured estate-to-office taxi or app origin–destination dataset. `commuteIntensity(absoluteMinute)` uses local game-clock minutes, is strongest at 08:00–09:00, and smoothly tapers within 06:30–10:30. Its values, destination weights (business up to 2.2; transport up to 1.3; others 1), and wider shoulder times are game calibration choices, not fitted population probabilities. No fare bonus or residential-income multiplier is introduced.

The [Transport Department's TCS 2022 final report, 2025 version](https://www.td.gov.hk/filemanager/en/content_5349/tcs2022_eng.pdf), §3.3.8, reports 42% of home-to-work trips in the 08:00–09:00 peak. This covers mechanised trips across modes. Table 3.6 puts taxi at 3% of home-based-work boardings, so the 42% figure must not be described as a taxi/app market share or an estate-specific probability.

The [2017 research report, project 2015.A8.029.15C](https://www.cepu.gov.hk/doc/en/research_report%28PDF%29/2015_A8_029_15C_Final%20Report_Prof%20Wong.pdf), Figure 3.8, supplies older contextual taxi-use patterns with a local morning peak around 07:00–09:00. Its charts use older survey observations; they are not current live dispatch data. The research was funded by the HKSAR Government's Public Policy Research Funding Scheme; findings are those of the research team.

The [2021 Census Main Results](https://www.census2021.gov.hk/doc/pub/21c-main-results.pdf), §6.41, reports a HK$40,000 median monthly income from main employment among workers mainly commuting by taxi. That is neither driver revenue nor any named estate's resident income, and it is not used by this implementation to assign estate demand or prices.

Morning event aliases use authentic entries already bundled from the Lands Department catalogue. Coordinates retain their existing building-centroid basis and road-proxy node; they are not certified taxi entrances. A building record represents the broader estate area for simulation only:

| Display alias | Existing catalogue record |
| --- | --- |
| Sorrento area / 擎天半島一帶 | `building-1108241290` — Sorrento Tower 1 |
| Whampoa Garden area / 黃埔花園一帶 | `building-1108241439` — Bamboo Mansions Block 4 |
| City One Shatin area / 沙田第一城一帶 | `building-1102444542` — Block 4 |
| Park Central area / 將軍澳中心一帶 | `building-1101781191` — Tower 11 |
| Aqua Marine area / 碧海藍天一帶 | `building-1108225461` — Block 1 |
| Kornhill area / 康怡花園一帶 | `building-1103123646` — Block R |

The helper is deterministic and makes no catalogue scan. The shared event scheduler retains its seeded common-clock contract. Engine integration is separate: candidate destination sampling must retain legal routes, other positive destination probabilities, and the existing pricing/accounting rules.
