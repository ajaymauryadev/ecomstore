// Register small API definitions before restoring snapshots. Screen components
// remain lazy; dormant queries can still refresh after a change on another device.
import.meta.glob('../features/**/*Api.js', { eager: true });
