import { world, system, BlockPermutation, Vector3, Dimension, Player } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';

const PROTECTION_BLOCK = 'minecraft:diamond_block';
const PARTICLE_TYPE = 'minecraft:villager_happy';
const PROTECTION_RADIUS = 5;
const PARTICLE_HEIGHT_OFFSET = 1;
const PARTICLE_DURATION = 2400;
const PREVIEW_ITEM = 'minecraft:stick';

const TERRITORY_NOTIFICATION_INTERVAL = 60;
const OWNER_MESSAGE_COLOR = '§a';
const VISITOR_MESSAGE_COLOR = '§f';
const OWNER_ICON = '';
const VISITOR_ICON = '';
const EXIT_ICON = '';

const PROTECTION_AREAS_KEY = 'protectionAreas';
const PLAYER_DATA_KEY = 'playerProtectionData';
const NEXT_AREA_ID_KEY = 'nextAreaId';
const PROTECTION_STONES_KEY = 'protectionStones';
const SYSTEM_CONFIG_KEY = 'systemConfig';

interface ProtectionArea {
    id: string;
    center: Vector3;
    playerId: string;
    playerName: string;
    ticksRemaining: number;
    dimensionId: string;
    createdAt: number;
    isPermanent: boolean;
    stoneId?: string;
    showParticles: boolean;
    members: string[]; // Array of player IDs who are members
    pvpEnabled: boolean; // Toggle for PvP in the area
    explosionsEnabled: boolean;
}

interface ProtectionStone {
    id: string;
    location: Vector3;
    dimensionId: string;
    playerId: string;
    playerName: string;
    areaId: string;
    placedAt: number;
    isActive: boolean;
}

interface PlayerTerritoryState {
    currentAreaId: string | null;
    lastNotificationTick: number;
    isInTerritory: boolean;
    lastAreaOwner: string | null;
}

interface PlayerProtectionData {
    totalAreas: number;
    lastActivity: number;
    protectionsCreated: string[];
    stonesPlaced: string[];
}

interface SystemConfig {
    version: string;
    lastSaved: number;
    totalAreasCreated: number;
    totalStonesPlaced: number;
}

const activeProtectionAreas: ProtectionArea[] = [];
const activeProtectionStones: ProtectionStone[] = [];
const playerTerritoryStates: Map<string, PlayerTerritoryState> = new Map();
const playerProtectionDataCache: Map<string, PlayerProtectionData> = new Map();
let systemConfig: SystemConfig = {
    version: '2.0.0',
    lastSaved: 0,
    totalAreasCreated: 0,
    totalStonesPlaced: 0
};

function initializeDynamicProperties(): void {
    try {
        if (!world.getDynamicProperty(PROTECTION_AREAS_KEY)) {
            world.setDynamicProperty(PROTECTION_AREAS_KEY, JSON.stringify([]));
        }
        if (!world.getDynamicProperty(PROTECTION_STONES_KEY)) {
            world.setDynamicProperty(PROTECTION_STONES_KEY, JSON.stringify([]));
        }
        if (!world.getDynamicProperty(PLAYER_DATA_KEY)) {
            world.setDynamicProperty(PLAYER_DATA_KEY, JSON.stringify({}));
        }
        if (!world.getDynamicProperty(NEXT_AREA_ID_KEY)) {
            world.setDynamicProperty(NEXT_AREA_ID_KEY, 1);
        }
        if (!world.getDynamicProperty(SYSTEM_CONFIG_KEY)) {
            world.setDynamicProperty(SYSTEM_CONFIG_KEY, JSON.stringify(systemConfig));
        } else {
            const configStr = world.getDynamicProperty(SYSTEM_CONFIG_KEY) as string;
            systemConfig = JSON.parse(configStr);
        }
    } catch (error) {
        // Logging removed
    }
}

function saveProtectionStones(): void {
    try {
        const stonesData = activeProtectionStones.map(stone => ({
            ...stone,
            dimensionId: stone.dimensionId
        }));
        world.setDynamicProperty(PROTECTION_STONES_KEY, JSON.stringify(stonesData));
        systemConfig.lastSaved = system.currentTick;
        systemConfig.totalStonesPlaced = stonesData.length;
        world.setDynamicProperty(SYSTEM_CONFIG_KEY, JSON.stringify(systemConfig));
    } catch (error) {
        // Logging removed
    }
}

function loadProtectionStones(): void {
    try {
        const stonesDataStr = world.getDynamicProperty(PROTECTION_STONES_KEY) as string;
        if (stonesDataStr) {
            const stonesData = JSON.parse(stonesDataStr) as ProtectionStone[];
            activeProtectionStones.length = 0;
            for (const stoneData of stonesData) {
                activeProtectionStones.push(stoneData);
            }
        }
    } catch (error) {
        // Logging removed
    }
}

function saveProtectionAreas(): void {
    try {
        const areasData = activeProtectionAreas.map(area => ({
            ...area,
            dimensionId: area.dimensionId
        }));
        world.setDynamicProperty(PROTECTION_AREAS_KEY, JSON.stringify(areasData));
        systemConfig.lastSaved = system.currentTick;
        systemConfig.totalAreasCreated = areasData.length;
        world.setDynamicProperty(SYSTEM_CONFIG_KEY, JSON.stringify(systemConfig));
    } catch (error) {
        // Logging removed
    }
}

function loadProtectionAreas(): void {
    try {
        const areasDataStr = world.getDynamicProperty(PROTECTION_AREAS_KEY) as string;
        if (areasDataStr) {
            const areasData = JSON.parse(areasDataStr) as ProtectionArea[];
            activeProtectionAreas.length = 0;
            for (const areaData of areasData) {
                const area: ProtectionArea = {
                    ...areaData,
                    dimensionId: areaData.dimensionId,
                    showParticles: areaData.showParticles ?? true
                };
                activeProtectionAreas.push(area);
            }
        }
    } catch (error) {
        // Logging removed
    }
}

function savePlayerProtectionData(): void {
    try {
        const playerDataObj: Record<string, PlayerProtectionData> = {};
        for (const [playerId, data] of playerProtectionDataCache) {
            playerDataObj[playerId] = data;
        }
        world.setDynamicProperty(PLAYER_DATA_KEY, JSON.stringify(playerDataObj));
    } catch (error) {
        // Logging removed
    }
}

function loadPlayerProtectionData(): void {
    try {
        const playerDataStr = world.getDynamicProperty(PLAYER_DATA_KEY) as string;
        if (playerDataStr) {
            const playerDataObj = JSON.parse(playerDataStr) as Record<string, PlayerProtectionData>;
            playerProtectionDataCache.clear();
            for (const [playerId, data] of Object.entries(playerDataObj)) {
                playerProtectionDataCache.set(playerId, data);
            }
        }
    } catch (error) {
        // Logging removed
    }
}

function generateAreaId(): string {
    try {
        let nextId = world.getDynamicProperty(NEXT_AREA_ID_KEY) as number || 1;
        const areaId = `area_${nextId}_${Date.now().toString(36)}`;
        world.setDynamicProperty(NEXT_AREA_ID_KEY, nextId + 1);
        return areaId;
    } catch (error) {
        // Logging removed
        return `area_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

function generateStoneId(): string {
    return `stone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getDimensionById(dimensionId: string): Dimension | null {
    try {
        switch (dimensionId) {
            case 'minecraft:overworld':
                return world.getDimension('overworld');
            case 'minecraft:nether':
                return world.getDimension('nether');
            case 'minecraft:the_end':
                return world.getDimension('the_end');
            default:
                return world.getDimension('overworld');
        }
    } catch (error) {
        // Logging removed
        return world.getDimension('overworld');
    }
}

function updatePlayerProtectionData(playerId: string, playerName: string, areaId: string, stoneId?: string): void {
    if (!playerProtectionDataCache.has(playerId)) {
        playerProtectionDataCache.set(playerId, {
            totalAreas: 0,
            lastActivity: system.currentTick,
            protectionsCreated: [],
            stonesPlaced: []
        });
    }
    const data = playerProtectionDataCache.get(playerId)!;
    data.totalAreas++;
    data.lastActivity = system.currentTick;
    data.protectionsCreated.push(areaId);
    if (stoneId) {
        data.stonesPlaced.push(stoneId);
    }
    savePlayerProtectionData();
}

function findProtectionStoneByLocation(location: Vector3, dimensionId: string): ProtectionStone | null {
    return activeProtectionStones.find(stone =>
        stone.location.x === location.x &&
        stone.location.y === location.y &&
        stone.location.z === location.z &&
        stone.dimensionId === dimensionId
    ) || null;
}

function findProtectionAreaByLocation(location: Vector3, dimensionId: string): ProtectionArea | null {
    return activeProtectionAreas.find(area =>
        area.center.x === location.x &&
        area.center.y === location.y &&
        area.center.z === location.z &&
        area.dimensionId === dimensionId
    ) || null;
}

function isPlayerInProtectionArea(playerPos: Vector3, area: ProtectionArea): boolean {
    const dx = Math.abs(playerPos.x - area.center.x);
    const dz = Math.abs(playerPos.z - area.center.z);
    return dx <= PROTECTION_RADIUS && dz <= PROTECTION_RADIUS;
}

function findPlayerCurrentArea(player: Player): ProtectionArea | null {
    const playerPos = player.location;
    for (const area of activeProtectionAreas) {
        if (player.dimension.id === area.dimensionId && isPlayerInProtectionArea(playerPos, area)) {
            return area;
        }
    }
    return null;
}

function canPlayerBuildInArea(player: Player, area: ProtectionArea): boolean {
    return area.playerId === player.id || area.members.includes(player.id);
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
    const { block, player, dimension } = event;

    if (block.typeId === PROTECTION_BLOCK) {
        // Logic for placing protection block...
        const blockLocation = block.location;
        const areaId = generateAreaId();
        const stoneId = generateStoneId();
        const protectionStone: ProtectionStone = {
            id: stoneId,
            location: blockLocation,
            dimensionId: dimension.id,
            playerId: player.id,
            playerName: player.name,
            areaId: areaId,
            placedAt: system.currentTick,
            isActive: true
        };
        const protectionArea: ProtectionArea = {
            id: areaId,
            center: blockLocation,
            playerId: player.id,
            playerName: player.name,
            ticksRemaining: PARTICLE_DURATION,
            dimensionId: dimension.id,
            createdAt: system.currentTick,
            isPermanent: true,
            stoneId: stoneId,
            showParticles: true,
            members: [],
            pvpEnabled: false,
            explosionsEnabled: false
        };
        activeProtectionStones.push(protectionStone);
        activeProtectionAreas.push(protectionArea);
        updatePlayerProtectionData(player.id, player.name, areaId, stoneId);
        saveProtectionStones();
        saveProtectionAreas();
        const areaSize = (PROTECTION_RADIUS * 2) + 1;
        player.sendMessage(`§aพื้นที่ป้องกันถูกสร้างแล้ว!`);
        player.sendMessage(`§7ขนาดพื้นที่: ${areaSize}x${areaSize} บล็อค`);
        player.sendMessage(`§aข้อมูลถูกบันทึกแล้ว - คงอยู่แม้ออกจากโลก!`);
        showProtectionParticles(blockLocation, dimension);
    } else {
        const currentArea = findPlayerCurrentArea(player);
        if (currentArea && !canPlayerBuildInArea(player, currentArea)) {
            // ใช้ beforeEvents.itemUse เพื่อยกเลิกการวางบล็อคก่อนที่จะเกิดขึ้น
            system.runTimeout(() => {
                try {
                    // คืนบล็อคให้ผู้เล่น
                    const inventory = player.getComponent('minecraft:inventory');
                    if (inventory && inventory.container) {
                        const blockPermutation = block.permutation;
                        const itemStack = blockPermutation.getItemStack(1);
                        if (itemStack) {
                            // ลบบล็อคที่วางและคืนไอเทมให้ผู้เล่น
                            block.setType('minecraft:air');
                            inventory.container.addItem(itemStack);
                        }
                    }
                    player.sendMessage(`§c🚫 คุณไม่สามารถวางบล็อคในพื้นที่ของ ${currentArea.playerName} ได้!`);
                    player.sendMessage(`§7💡 เฉพาะเจ้าของพื้นที่และสมาชิกเท่านั้นที่สามารถก่อสร้างได้`);
                } catch (error) {
                    console.error("Error in playerPlaceBlock handler:", error);
                }
            }, 1);
        }
    }
});

// เพิ่ม event handler สำหรับการระเบิด
world.beforeEvents.explosion.subscribe((event) => {
    const explosionLocation = event.source.location;
    const dimension = event.dimension;

    // ตรวจสอบว่าการระเบิดอยู่ในพื้นที่ป้องกันหรือไม่
    const affectedArea = activeProtectionAreas.find(area =>
        area.dimensionId === dimension.id &&
        Math.abs(explosionLocation.x - area.center.x) <= PROTECTION_RADIUS &&
        Math.abs(explosionLocation.z - area.center.z) <= PROTECTION_RADIUS
    );

    // ถ้าอยู่ในพื้นที่ป้องกันและการระเบิดถูกปิดใช้งาน
    if (affectedArea && !affectedArea.explosionsEnabled) {
        event.cancel = true; // ยกเลิกการระเบิด

        // แจ้งเตือนผู้เล่นในบริเวณใกล้เคียง
        const nearbyPlayers = [...world.getPlayers()].filter(p =>
            p.dimension.id === dimension.id &&
            Math.abs(p.location.x - explosionLocation.x) <= 10 &&
            Math.abs(p.location.z - explosionLocation.z) <= 10
        );

        nearbyPlayers.forEach(player => {
            player.sendMessage("§cการระเบิดถูกป้องกันในพื้นที่นี้!");
        });
    }
});

// ป้องกันการโต้ตอบกับเอนทิตี้และบล็อค
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target } = event;

    if (!target) return;

    const currentArea = findPlayerCurrentArea(player);
    if (currentArea && !canPlayerBuildInArea(player, currentArea)) {
        // รายการเอนทิตี้ที่ต้องการป้องกัน
        const protectedEntities = [
            'minecraft:villager',
            'minecraft:horse',
            'minecraft:donkey',
            'minecraft:mule',
            'minecraft:llama',
            'minecraft:parrot',
            'minecraft:wolf',
            'minecraft:cat',
            'minecraft:armor_stand',
            'minecraft:item_frame',
            'minecraft:painting',
            'minecraft:minecart',
            'minecraft:chest_minecart',
            'minecraft:hopper_minecart',
            'minecraft:boat',
            'minecraft:chest_boat'
        ];

        if (protectedEntities.includes(target.typeId)) {
            event.cancel = true;
            player.sendMessage(`§c🚫 คุณไม่สามารถโต้ตอบกับ ${target.typeId.replace('minecraft:', '')} ในพื้นที่ของ ${currentArea.playerName} ได้!`);
            player.sendMessage(`§7💡 เฉพาะเจ้าของพื้นที่และสมาชิกเท่านั้นที่สามารถโต้ตอบได้`);
        }
    }
});

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block } = event;

    if (!block || !player) return;

    const currentArea = findPlayerCurrentArea(player);
    if (currentArea && !canPlayerBuildInArea(player, currentArea)) {
        // รายการบล็อคที่ต้องการป้องกัน
        const protectedBlocks = [
            'minecraft:chest',
            'minecraft:barrel',
            'minecraft:furnace',
            'minecraft:blast_furnace',
            'minecraft:smoker',
            'minecraft:brewing_stand',
            'minecraft:dispenser',
            'minecraft:dropper',
            'minecraft:hopper',
            'minecraft:shulker_box',
            'minecraft:trapped_chest',
            'minecraft:beacon',
            'minecraft:anvil',
            'minecraft:crafting_table',
            'minecraft:enchanting_table',
            'minecraft:lever',
            'minecraft:button',
            'minecraft:door',
            'minecraft:trapdoor',
            'minecraft:fence_gate',
            'minecraft:campfire',
            'minecraft:soul_campfire',
            'minecraft:composter',
            'minecraft:jukebox',
            'minecraft:noteblock',
            'minecraft:respawn_anchor'
        ];

        // บล็อคที่อนุญาตให้ใช้งานได้
        const allowedBlocks = [
            'minecraft:bed'  // อนุญาตให้นอนได้
        ];

        if (protectedBlocks.includes(block.typeId) && !allowedBlocks.includes(block.typeId)) {
            event.cancel = true;
            player.sendMessage(`§c🚫 คุณไม่สามารถใช้งาน ${block.typeId.replace('minecraft:', '')} ในพื้นที่ของ ${currentArea.playerName} ได้!`);
            player.sendMessage(`§7💡 เฉพาะเจ้าของพื้นที่และสมาชิกเท่านั้นที่สามารถใช้งานได้`);
        }
    }
});

world.afterEvents.entityHurt.subscribe((event) => {
    const { damageSource, hurtEntity } = event;

    // Check if it's PvP damage
    if (damageSource.damagingEntity?.typeId === "minecraft:player" &&
        hurtEntity.typeId === "minecraft:player") {

        const location = hurtEntity.location;
        const dimension = hurtEntity.dimension;

        // Find if combat is in a protected area
        const area = activeProtectionAreas.find(area =>
            area.dimensionId === dimension.id &&
            isPlayerInProtectionArea(location, area)
        );

        // If PvP is disabled in the area, notify players and potentially apply consequences
        if (area && !area.pvpEnabled) {
            // Since this is afterEvents, we can't cancel the damage directly
            // Instead, we can heal the player back or apply other consequences
            if (hurtEntity.typeId === "minecraft:player") {
                const hurtPlayer = hurtEntity as Player;

                // Heal the player back to prevent PvP damage
                try {
                    const healthComponent = hurtPlayer.getComponent('minecraft:health');
                    if (healthComponent && event.damage > 0) {
                        // Restore the health that was lost
                        hurtPlayer.addEffect('minecraft:instant_health', 1, {
                            amplifier: 255,
                            showParticles: false
                        });
                    }
                } catch (error) {
                    // Fallback: just notify
                }

                hurtPlayer.sendMessage(`§c🛡 การต่อสู้ถูกปิดใช้งานในพื้นที่นี้!`);
            }

            if (damageSource.damagingEntity?.typeId === "minecraft:player") {
                const attackingPlayer = damageSource.damagingEntity as Player;
                attackingPlayer.sendMessage(`§c⚠ คุณไม่สามารถโจมตีผู้เล่นในพื้นที่นี้ได้!`);
                attackingPlayer.sendMessage(`§7พื้นที่นี้ปิดการต่อสู้โดย ${area.playerName}`);
            }
        }
    }
});



world.afterEvents.playerBreakBlock.subscribe((event) => {
    const { block, player, brokenBlockPermutation } = event;
    const brokenBlockType = brokenBlockPermutation.type.id;
    if (brokenBlockType === PROTECTION_BLOCK) {
        const blockLocation = block.location;
        const stone = activeProtectionStones.find(s =>
            Math.floor(s.location.x) === Math.floor(blockLocation.x) &&
            Math.floor(s.location.y) === Math.floor(blockLocation.y) &&
            Math.floor(s.location.z) === Math.floor(blockLocation.z) &&
            s.dimensionId === block.dimension.id
        );
        if (stone) {
            if (stone.playerId === player.id) {
                const associatedArea = activeProtectionAreas.find(area => area.id === stone.areaId);
                const stoneIndex = activeProtectionStones.findIndex(s => s.id === stone.id);
                if (stoneIndex !== -1) {
                    activeProtectionStones.splice(stoneIndex, 1);
                }
                if (associatedArea) {
                    const areaIndex = activeProtectionAreas.findIndex(area => area.id === stone.areaId);
                    if (areaIndex !== -1) {
                        activeProtectionAreas.splice(areaIndex, 1);
                    }
                }
                const playerData = playerProtectionDataCache.get(player.id);
                if (playerData) {
                    const stoneIdIndex = playerData.stonesPlaced.indexOf(stone.id);
                    if (stoneIdIndex !== -1) {
                        playerData.stonesPlaced.splice(stoneIdIndex, 1);
                    }
                    const areaIdIndex = playerData.protectionsCreated.indexOf(stone.areaId);
                    if (areaIdIndex !== -1) {
                        playerData.protectionsCreated.splice(areaIdIndex, 1);
                    }
                    if (playerData.totalAreas > 0) {
                        playerData.totalAreas--;
                    }
                    playerData.lastActivity = system.currentTick;
                }
                try {
                    saveProtectionStones();
                    saveProtectionAreas();
                    savePlayerProtectionData();
                } catch (saveError) {
                    // Logging removed
                }
                player.sendMessage('§cพื้นที่ป้องกันและหินป้องกันถูกยกเลิกแล้ว!');
                player.sendMessage('§aการเปลี่ยนแปลงถูกบันทึกแล้ว!');
            } else {
                player.sendMessage(`§cคุณไม่สามารถทำลายหินป้องกันของ ${stone.playerName} ได้!`);
                system.runTimeout(() => {
                    try {
                        const protectionBlock = BlockPermutation.resolve(PROTECTION_BLOCK);
                        block.setPermutation(protectionBlock);
                    } catch (error) {
                        // Logging removed
                        try {
                            block.setType(PROTECTION_BLOCK);
                        } catch (fallbackError) {
                            // Logging removed
                        }
                    }
                }, 1);
            }
        } else {
            const orphanedArea = activeProtectionAreas.find(area =>
                Math.floor(area.center.x) === Math.floor(blockLocation.x) &&
                Math.floor(area.center.y) === Math.floor(blockLocation.y) &&
                Math.floor(area.center.z) === Math.floor(blockLocation.z) &&
                area.dimensionId === block.dimension.id
            );
            if (orphanedArea) {
                if (orphanedArea.playerId === player.id) {
                    const areaIndex = activeProtectionAreas.findIndex(area => area.id === orphanedArea.id);
                    if (areaIndex !== -1) {
                        activeProtectionAreas.splice(areaIndex, 1);
                        saveProtectionAreas();
                        player.sendMessage('§cพื้นที่ป้องกันที่ไม่มีหินเชื่อมโยงถูกยกเลิกแล้ว!');
                    }
                } else {
                    player.sendMessage(`§c🚫 คุณไม่สามารถทำลายหินป้องกันของ ${orphanedArea.playerName} ได้!`);
                    system.runTimeout(() => {
                        try {
                            block.setType(PROTECTION_BLOCK);
                        } catch (error) {
                            // Logging removed
                        }
                    }, 1);
                }
            } else {
                // Logging removed
            }
        }
    } else {
        const currentArea = findPlayerCurrentArea(player);
        if (currentArea && !canPlayerBuildInArea(player, currentArea)) {
            player.sendMessage(`§cคุณไม่สามารถทำลายบล็อคในพื้นที่ของ ${currentArea.playerName} ได้!`);
            player.sendMessage(`§7เฉพาะเจ้าของพื้นที่เท่านั้นที่สามารถทำลายได้`);
            system.runTimeout(() => {
                try {
                    block.setPermutation(brokenBlockPermutation);
                } catch (error) {
                    // Logging removed
                }
            }, 1);
        }
    }
});

function showProtectionParticles(center: Vector3, dimension: Dimension): void {
    const particleLocations: Vector3[] = [];
    for (let x = -PROTECTION_RADIUS; x <= PROTECTION_RADIUS; x++) {
        for (let z = -PROTECTION_RADIUS; z <= PROTECTION_RADIUS; z++) {
            if (x === 0 && z === 0) continue;
            if (Math.abs(x) === PROTECTION_RADIUS || Math.abs(z) === PROTECTION_RADIUS) {
                const particlePos: Vector3 = {
                    x: center.x + x,
                    y: center.y + PARTICLE_HEIGHT_OFFSET,
                    z: center.z + z
                };
                particleLocations.push(particlePos);
            }
        }
    }
    particleLocations.forEach(pos => {
        try {
            dimension.spawnParticle(PARTICLE_TYPE, pos);
        } catch (error) {
            // Logging removed
        }
    });
}

function showProtectionOutline(center: Vector3, dimension: Dimension): void {
    for (let i = -PROTECTION_RADIUS; i <= PROTECTION_RADIUS; i++) {
        const edges = [
            { x: center.x + i, y: center.y + PARTICLE_HEIGHT_OFFSET, z: center.z - PROTECTION_RADIUS },
            { x: center.x + i, y: center.y + PARTICLE_HEIGHT_OFFSET, z: center.z + PROTECTION_RADIUS },
            { x: center.x - PROTECTION_RADIUS, y: center.y + PARTICLE_HEIGHT_OFFSET, z: center.z + i },
            { x: center.x + PROTECTION_RADIUS, y: center.y + PARTICLE_HEIGHT_OFFSET, z: center.z + i }
        ];
        edges.forEach(edge => {
            try {
                dimension.spawnParticle(PARTICLE_TYPE, edge);
            } catch (error) {
                // Logging removed
            }
        });
    }
}

async function showAreaSettingsForm(player: Player, area: ProtectionArea): Promise<void> {
    try {
        // สร้าง ActionFormData สำหรับเมนูหลัก
        const mainForm = new ActionFormData()
            .title("§6การตั้งค่าพื้นที่")
            .body("§fเลือกการตั้งค่าที่ต้องการจัดการ")
            .button("§aตั้งค่าทั่วไป\n§8เอฟเฟ็ค, PvP, การระเบิด")
            .button("§bจัดการสมาชิก\n§8เพิ่ม/ลบ สมาชิก")
            .button("§cออก");

        const mainResponse = await mainForm.show(player);
        if (mainResponse.canceled) {
            player.sendMessage("§7เมนูการตั้งค่าถูกยกเลิก");
            return;
        }

        switch (mainResponse.selection) {
            case 0: // ตั้งค่าทั่วไป
                await showGeneralSettingsForm(player, area);
                break;
            case 1: // จัดการสมาชิก
                await showMemberManagementForm(player, area);
                break;
            case 2: // ออก
                player.sendMessage("§7ออกจากเมนูการตั้งค่า");
                break;
        }
    } catch (error) {
        player.sendMessage("§c❌ เกิดข้อผิดพลาดในการแสดงเมนู");
        console.error("Error in showAreaSettingsForm:", error);
    }
}

async function showGeneralSettingsForm(player: Player, area: ProtectionArea): Promise<void> {
    try {
        const form = new ModalFormData()
            .title("§6ตั้งค่าทั่วไป")
            .toggle("§aแสดงเอฟเฟ็ค", area.showParticles)
            .toggle("§cเปิด PvP", area.pvpEnabled)
            .toggle("§4เปิดการระเบิด", area.explosionsEnabled || false);

        const response = await form.show(player);
        if (response.canceled || !response.formValues) {
            player.sendMessage("§7ยกเลิกการตั้งค่าทั่วไป");
            return;
        }

        const [showParticles, pvpEnabled, explosionsEnabled] = response.formValues;
        let changed = false;

        if (area.showParticles !== showParticles) {
            area.showParticles = showParticles as boolean;
            changed = true;
            player.sendMessage(
                showParticles
                    ? "§a✅ เปิดการแสดงเอฟเฟ็คแล้ว"
                    : "§c❌ ปิดการแสดงเอฟเฟ็คแล้ว"
            );
        }

        if (area.pvpEnabled !== pvpEnabled) {
            area.pvpEnabled = pvpEnabled as boolean;
            changed = true;
            player.sendMessage(
                pvpEnabled
                    ? "§c⚔ เปิดการต่อสู้ในพื้นที่แล้ว"
                    : "§a🛡 ปิดการต่อสู้ในพื้นที่แล้ว"
            );
        }

        if (area.explosionsEnabled !== explosionsEnabled) {
            area.explosionsEnabled = explosionsEnabled as boolean;
            changed = true;
            player.sendMessage(
                explosionsEnabled
                    ? "§c💥 เปิดการระเบิดในพื้นที่แล้ว"
                    : "§a🛡 ปิดการระเบิดในพื้นที่แล้ว"
            );
        }

        if (changed) {
            saveProtectionAreas();
            player.sendMessage("§a💾 บันทึกการตั้งค่าทั่วไปแล้ว!");
        }
    } catch (error) {
        player.sendMessage("§c❌ เกิดข้อผิดพลาดในการตั้งค่าทั่วไป");
        console.error("Error in showGeneralSettingsForm:", error);
    }
}

async function showMemberManagementForm(player: Player, area: ProtectionArea): Promise<void> {
    try {
        // สร้าง ActionFormData สำหรับเมนูจัดการสมาชิก
        const memberForm = new ActionFormData()
            .title("§6จัดการสมาชิก")
            .body("§fเลือกการดำเนินการ")
            .button("§aดูรายชื่อสมาชิก\n§8แสดงสมาชิกทั้งหมด")
            .button("§bเพิ่มสมาชิกใหม่\n§8ป้อนชื่อผู้เล่น")
            .button("§cลบสมาชิก\n§8เลือกจากรายชื่อ")
            .button("§cกลับ");

        const memberResponse = await memberForm.show(player);
        if (memberResponse.canceled) {
            return;
        }

        switch (memberResponse.selection) {
            case 0: // ดูรายชื่อสมาชิก
                await showMembersList(player, area);
                break;
            case 1: // เพิ่มสมาชิกใหม่
                await showAddMemberForm(player, area);
                break;
            case 2: // ลบสมาชิก
                await showRemoveMemberForm(player, area);
                break;
            case 3: // กลับ
                await showAreaSettingsForm(player, area);
                break;
        }
    } catch (error) {
        player.sendMessage("§c❌ เกิดข้อผิดพลาดในการจัดการสมาชิก");
        console.error("Error in showMemberManagementForm:", error);
    }
}

async function showMembersList(player: Player, area: ProtectionArea): Promise<void> {
    if (area.members.length === 0) {
        player.sendMessage("§7ไม่มีสมาชิกในพื้นที่นี้");
        return;
    }

    // แสดงรายชื่อสมาชิกทั้งหมด
    const onlinePlayers = [...world.getPlayers()];
    const memberList = area.members.map(memberId => {
        const memberPlayer = onlinePlayers.find(p => p.id === memberId);
        return memberPlayer ?
            `§a● ${memberPlayer.name} §7(ออนไลน์)` :
            `§7○ ID: ${memberId.slice(-8)} §7(ออฟไลน์)`;
    }).join("\n");

    const form = new MessageFormData()
        .title("§6รายชื่อสมาชิก")
        .body(`§fสมาชิกทั้งหมด §7(${area.members.length} คน):\n${memberList}`)
        .button1("§aตกลง")
        .button2("§7กลับ");

    await form.show(player);
}

async function showAddMemberForm(player: Player, area: ProtectionArea): Promise<void> {
    const form = new ModalFormData()
        .title("§6เพิ่มสมาชิก")
        .textField("§fป้อนชื่อผู้เล่น", "ชื่อผู้เล่น");

    const response = await form.show(player);
    if (response.canceled || !response.formValues) {
        return;
    }

    const playerName = (response.formValues[0] as string).trim();
    if (!playerName) {
        player.sendMessage("§c❌ กรุณาป้อนชื่อผู้เล่น");
        return;
    }

    // หาผู้เล่นจากชื่อ
    const targetPlayer = [...world.getPlayers()].find(p =>
        p.name.toLowerCase() === playerName.toLowerCase()
    );

    if (targetPlayer) {
        if (targetPlayer.id === player.id) {
            player.sendMessage("§c❌ คุณไม่สามารถเพิ่มตัวเองเป็นสมาชิกได้");
            return;
        }

        if (area.members.includes(targetPlayer.id)) {
            player.sendMessage(`§e⚠ ${targetPlayer.name} เป็นสมาชิกอยู่แล้ว`);
            return;
        }

        area.members.push(targetPlayer.id);
        saveProtectionAreas();
        player.sendMessage(`§a✅ เพิ่ม ${targetPlayer.name} เป็นสมาชิกแล้ว`);
        targetPlayer.sendMessage(`§a🔔 คุณถูกเพิ่มเป็นสมาชิกในพื้นที่ของ ${player.name}`);
    } else {
        player.sendMessage(`§c❌ ไม่พบผู้เล่นชื่อ ${playerName}`);
    }
}

async function showRemoveMemberForm(player: Player, area: ProtectionArea): Promise<void> {
    if (area.members.length === 0) {
        player.sendMessage("§7ไม่มีสมาชิกให้ลบ");
        return;
    }

    // สร้างรายการสมาชิกที่จะลบ
    const onlinePlayers = [...world.getPlayers()];
    const memberOptions = area.members.map(memberId => {
        const memberPlayer = onlinePlayers.find(p => p.id === memberId);
        return memberPlayer ?
            `${memberPlayer.name} §7(ออนไลน์)` :
            `ID: ${memberId.slice(-8)} §7(ออฟไลน์)`;
    });

    const form = new ModalFormData()
        .title("§6ลบสมาชิก")
        .dropdown("§fเลือกสมาชิกที่ต้องการลบ", memberOptions);

    const response = await form.show(player);
    if (response.canceled || !response.formValues) {
        return;
    }

    const selectedIndex = response.formValues[0] as number;
    const memberId = area.members[selectedIndex];
    const memberPlayer = onlinePlayers.find(p => p.id === memberId);

    area.members.splice(selectedIndex, 1);
    saveProtectionAreas();

    if (memberPlayer) {
        player.sendMessage(`§c❌ ลบ ${memberPlayer.name} ออกจากสมาชิกแล้ว`);
        memberPlayer.sendMessage(`§c🔔 คุณถูกลบออกจากพื้นที่ของ ${player.name}`);
    } else {
        player.sendMessage(`§c❌ ลบสมาชิก ID: ${memberId.slice(-8)} แล้ว`);
    }
}

function updatePlayerTerritoryActionbar(player: Player, currentTick: number): void {
    const playerId = player.id;
    const currentArea = findPlayerCurrentArea(player);
    if (!playerTerritoryStates.has(playerId)) {
        playerTerritoryStates.set(playerId, {
            currentAreaId: null,
            lastNotificationTick: 0,
            isInTerritory: false,
            lastAreaOwner: null
        });
    }
    const playerState = playerTerritoryStates.get(playerId)!;
    const currentAreaId = currentArea ? currentArea.id : null;
    const justEntered = !playerState.isInTerritory && currentArea !== null;
    const justLeft = playerState.isInTerritory && currentArea === null;
    const changedArea = currentAreaId !== playerState.currentAreaId;
    if (justEntered || changedArea) {
        if (currentArea) {
            const isOwner = currentArea.playerId === playerId;
            if (isOwner) {
                player.sendMessage(`§aยินดีต้อนรับสู่ดินแดนของคุณ!`);
                if (currentArea.stoneId) {
                }
            } else {
                player.sendMessage(`§cคุณได้เข้าสู่ดินแดนของ §f${currentArea.playerName}`);
                player.sendMessage(`§7คุณไม่สามารถก่อสร้างหรือทำลายในพื้นที่นี้ได้`);
            }
        }
    }
    if (justLeft && playerState.lastAreaOwner) {
        if (playerState.lastAreaOwner === player.name) {
            player.sendMessage(`§aคุณได้ออกจากดินแดนของตัวเอง`);
        } else {
            player.sendMessage(`§7คุณได้ออกจากดินแดนของ §f${playerState.lastAreaOwner}`);
        }
    }
    playerState.currentAreaId = currentAreaId;
    playerState.isInTerritory = currentArea !== null;
    playerState.lastAreaOwner = currentArea ? currentArea.playerName : null;
    if (currentArea) {
        const isOwner = currentArea.playerId === playerId;
        const shouldUpdate = justEntered || changedArea ||
            (currentTick - playerState.lastNotificationTick >= TERRITORY_NOTIFICATION_INTERVAL);
        if (shouldUpdate) {
            let message: string;
            if (isOwner) {
                message = `${OWNER_MESSAGE_COLOR}${OWNER_ICON} ดินแดนของคุณ §8| §bเจ้าของ:§d ${currentArea.playerName}`;
            } else {
                message = `${VISITOR_MESSAGE_COLOR}${VISITOR_ICON} เข้าสู่ดินแดน §8| §bเจ้าของ:§d ${currentArea.playerName}`;
            }
            try {
                player.onScreenDisplay.setActionBar(message);
                playerState.lastNotificationTick = currentTick;
            } catch (error) {
                // Logging removed
            }
        }
    } else if (justLeft) {
        try {
            player.onScreenDisplay.setActionBar('');
        } catch (error) {
            // Logging removed
        }
    }
}

system.runInterval(() => {
    const currentTick = system.currentTick;
    let areasNeedSave = false;
    let stonesNeedSave = false;
    for (let i = activeProtectionAreas.length - 1; i >= 0; i--) {
        const area = activeProtectionAreas[i];
        if (area.ticksRemaining <= 0 && !area.isPermanent) {
            try {
                const owner = world.getPlayers().find(p => p.id === area.playerId);
                if (owner) {
                    owner.sendMessage(`§cพื้นที่ป้องกันของคุณหมดอายุแล้ว! (รหัส: ${area.id.slice(-8)})`);
                    owner.sendMessage(`§aการเปลี่ยนแปลงถูกบันทูลอัตโนมัติ`);
                }
            } catch (error) {
                // Logging removed
            }
            if (area.stoneId) {
                const stoneIndex = activeProtectionStones.findIndex(s => s.id === area.stoneId);
                if (stoneIndex !== -1) {
                    activeProtectionStones.splice(stoneIndex, 1);
                    stonesNeedSave = true;
                }
            }
            activeProtectionAreas.splice(i, 1);
            areasNeedSave = true;
            continue;
        }
        if (area.showParticles && area.ticksRemaining % 10 === 0) {
            try {
                const dimension = getDimensionById(area.dimensionId);
                if (dimension) {
                    showProtectionOutline(area.center, dimension);
                }
            } catch (error) {
                // Logging removed
            }
        }
        if (!area.isPermanent) {
            area.ticksRemaining--;
        }
    }
    if (areasNeedSave) {
        saveProtectionAreas();
    }
    if (stonesNeedSave) {
        saveProtectionStones();
    }
    try {
        const allPlayers = world.getPlayers();
        for (const player of allPlayers) {
            updatePlayerTerritoryActionbar(player, currentTick);
        }
    } catch (error) {
        // Logging removed
    }
}, 1);

world.afterEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event;
    if (itemStack.typeId === 'minecraft:book') {
        const viewDirection = player.getViewDirection();
        const playerLocation = player.location;
        const raycastOptions = {
            maxDistance: 5
        };
        try {
            const blockHit = player.dimension.getBlockFromRay(playerLocation, viewDirection, raycastOptions);
            if (blockHit && blockHit.block.typeId === PROTECTION_BLOCK) {
                const blockLocation = blockHit.block.location;
                const area = findProtectionAreaByLocation(blockLocation, blockHit.block.dimension.id);
                if (area) {
                    if (area.playerId === player.id) {
                        showAreaSettingsForm(player, area).catch(error => {
                            player.sendMessage("§c❌ ไม่สามารถเปิดเมนูการตั้งค่าได้");
                        });
                        return;
                    } else {
                        player.sendMessage("§c❌ คุณไม่ได้เป็นเจ้าของพื้นที่นี้!");
                        player.sendMessage(`§7พื้นที่นี้เป็นของ ${area.playerName}`);
                        if (area.members.includes(player.id)) {
                            player.sendMessage("§a✓ คุณเป็นสมาชิกในพื้นที่นี้");
                        }
                        return;
                    }
                } else {
                    const areaSize = (PROTECTION_RADIUS * 2) + 1;
                    player.sendMessage(`§a🔍 Showing preview for protection area! §7(${areaSize}x${areaSize} blocks)`);
                    showProtectionParticles(blockLocation, blockHit.block.dimension);
                    return;
                }
            }
        } catch (error) {
            // Logging removed
        }
        const playerPos = player.location;
        const blockBelow: Vector3 = {
            x: Math.floor(playerPos.x),
            y: Math.floor(playerPos.y) - 1,
            z: Math.floor(playerPos.z)
        };
        showProtectionParticles(blockBelow, player.dimension);
        const areaSize = (PROTECTION_RADIUS * 2) + 1;
        player.sendMessage(`§aแสดงตัวอย่างพื้นที่ป้องกัน! §7(${areaSize}x${areaSize} พื้นที่)`);
        const playerData = playerProtectionDataCache.get(player.id);
        if (playerData) {
            player.sendMessage(`§7สถิติของคุณ: สร้างพื้นที่ป้องกันแล้ว ${playerData.totalAreas} ครั้ง`);
        }
    }
});

world.afterEvents.playerLeave.subscribe((event) => {
    const playerId = event.playerId;
    if (playerTerritoryStates.has(playerId)) {
        playerTerritoryStates.delete(playerId);
    }
});

world.afterEvents.worldInitialize.subscribe(() => {
    system.runTimeout(() => {
        loadProtectionAreas();
        loadProtectionStones();
        loadPlayerProtectionData();
    }, 20);
});

system.runInterval(() => {
    const currentTick = system.currentTick;
    let areasNeedSave = false;
    let stonesNeedSave = false;
    for (let i = activeProtectionAreas.length - 1; i >= 0; i--) {
        const area = activeProtectionAreas[i];
        if (area.ticksRemaining <= 0 && !area.isPermanent) {
            try {
                const owner = world.getPlayers().find(p => p.id === area.playerId);
                if (owner) {
                    owner.sendMessage(`§cพื้นที่ป้องกันของคุณหมดอายุแล้ว! (รหัส: ${area.id.slice(-8)})`);
                    owner.sendMessage(`§aการเปลี่ยนแปลงถูกบันทูลอัตโนมัติ`);
                }
            } catch (error) {
                // Logging removed
            }
            if (area.stoneId) {
                const stoneIndex = activeProtectionStones.findIndex(s => s.id === area.stoneId);
                if (stoneIndex !== -1) {
                    activeProtectionStones.splice(stoneIndex, 1);
                    stonesNeedSave = true;
                }
            }
            activeProtectionAreas.splice(i, 1);
            areasNeedSave = true;
            continue;
        }
        if (area.showParticles && currentTick % 10 === 0) {
            try {
                const dimension = getDimensionById(area.dimensionId);
                if (dimension) {
                    showProtectionOutline(area.center, dimension);
                }
            } catch (error) {
                // Logging removed
            }
        }
        if (!area.isPermanent) {
            area.ticksRemaining--;
        }
    }
    if (areasNeedSave) {
        saveProtectionAreas();
    }
    if (stonesNeedSave) {
        saveProtectionStones();
    }
    try {
        const allPlayers = world.getPlayers();
        for (const player of allPlayers) {
            updatePlayerTerritoryActionbar(player, currentTick);
        }
    } catch (error) {
        // Logging removed
    }
}, 1);

export function cleanup(): void {
    saveProtectionAreas();
    saveProtectionStones();
    savePlayerProtectionData();
    activeProtectionAreas.length = 0;
    activeProtectionStones.length = 0;
    playerTerritoryStates.clear();
    playerProtectionDataCache.clear();
}

export function debugShowParticles(area: ProtectionArea): void {
    try {
        const dimension = getDimensionById(area.dimensionId);
        if (dimension) {
            showProtectionOutline(area.center, dimension);
        }
    } catch (error) {
        // Logging removed
    }
}

function initialize(): void {
    initializeDynamicProperties();
    system.runTimeout(() => {
        loadProtectionAreas();
        loadProtectionStones();
        loadPlayerProtectionData();
    }, 10);
}

try {
    initialize();
} catch (error) {
    // Logging removed
}

export {
    activeProtectionAreas,
    playerTerritoryStates,
    playerProtectionDataCache,
    showProtectionParticles,
    showProtectionOutline,
    saveProtectionAreas,
    loadProtectionAreas,
    PROTECTION_BLOCK,
    PROTECTION_RADIUS,
    PARTICLE_DURATION
};