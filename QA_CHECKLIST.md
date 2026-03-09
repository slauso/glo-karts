# TwistedKart Manual QA Checklist

## Per-Mode Smoke Checks

### Lobby (index.html)
- [ ] Page loads without console errors
- [ ] Menu music plays after first click
- [ ] Mute button toggles music on/off
- [ ] Kart carousel shows 18 kart models
- [ ] GLO effect selector works (color picker + effect type)
- [ ] Track selector shows 18+ tracks
- [ ] "Solo Race" button navigates to game.html
- [ ] "Solo Battle" button navigates to battle.html
- [ ] "Multiplayer" option navigates to realtime.html
- [ ] Grand Prix mode shows cup selection

### Solo Race (game.html)
- [ ] Loading screen appears then fades
- [ ] 3-2-1-GO countdown with audio beeps
- [ ] Engine sound starts at GO
- [ ] Background music plays
- [ ] Kart responds to arrow keys / WASD
- [ ] Lap counter HUD visible ("Lap 1/3")
- [ ] Checkpoint progression works
- [ ] Last lap triggers fanfare SFX + fast music
- [ ] Race finish shows results overlay
- [ ] Engine and music stop on finish
- [ ] Post-race music plays

### Solo Battle (battle.html)
- [ ] Arena loads with correct geometry
- [ ] 3-2-1-GO countdown with audio
- [ ] Weapon pickups spawn on map
- [ ] Picking up weapon shows HUD indicator
- [ ] Firing weapon plays weapon-specific SFX
- [ ] Bot opponents move and attack
- [ ] Damage numbers appear on hits
- [ ] Health bar updates on damage
- [ ] Respawn works with blink effect
- [ ] CTF: flags visible, scoring works

### Online Race (realtime.html → race_room)
- [ ] Prematch lobby shows with kart preview
- [ ] Countdown syncs for all players
- [ ] Remote players visible and moving
- [ ] Minimap shows player positions
- [ ] Lap HUD updates for all participants
- [ ] Weapon pickups work online
- [ ] Weapon fire/hit SFX per weapon type
- [ ] Race finish shows final standings
- [ ] Late-join players see current race state

### Online Battle (realtime.html → battle_room)
- [ ] Battle arena loads
- [ ] Kill feed shows on eliminations
- [ ] Respawn blink effect works
- [ ] Weapon fire + hit SFX play correctly
- [ ] Match end shows results

### Grand Prix
- [ ] Cup selection shows 5 cups
- [ ] Race 1 loads correct track
- [ ] Standings overlay shows after each race
- [ ] Score carries over between races
- [ ] Final results show medals (gold/silver/bronze)
- [ ] Resume after page reload works

## Browser Matrix
- [ ] Chrome (latest) - Desktop
- [ ] Firefox (latest) - Desktop
- [ ] Edge (latest) - Desktop
- [ ] Chrome (latest) - Android
- [ ] Safari (latest) - iOS (if available)

## Performance Checks
- [ ] Initial page load < 5s on broadband
- [ ] 60 FPS during solo race (no major drops)
- [ ] No memory leak during extended play (10+ min)
- [ ] Audio context properly cleaned up on page navigation

## Security Checks
- [ ] /colyseus monitor disabled in production (NODE_ENV=production)
- [ ] CORS restricted to known frontend origin
- [ ] No ROM files or large archives in production build
- [ ] Rate limiting prevents message flood
