"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Star, Sparkles } from "lucide-react";
import { useAuth } from "./lib/auth";
import { getVisibleNavGroups, type NavItem } from "./lib/navigation";

const TILE_ACCENTS = [
  { from: "#5b8fff", to: "#6c63ff", glow: "rgba(91,143,255,0.24)" },
  { from: "#10d9b0", to: "#06b6d4", glow: "rgba(16,217,176,0.22)" },
  { from: "#f6a233", to: "#f97316", glow: "rgba(246,162,51,0.20)" },
  { from: "#f05252", to: "#fb7185", glow: "rgba(240,82,82,0.18)" },
  { from: "#9b78ff", to: "#5b8fff", glow: "rgba(155,120,255,0.20)" },
  { from: "#22d3a0", to: "#84cc16", glow: "rgba(34,211,160,0.18)" },
];

const HOME_LAYOUT_STORAGE_VERSION = "maintai.home.launchpad.v2";

type LaunchpadItem = NavItem & { section: string };

type HomeLayoutState = {
  order: string[];
  favoriteIds: string[];
  favoriteOrder: string[];
  usage: Record<string, number>;
};

function itemId(item: Pick<LaunchpadItem, "href">) {
  return item.href;
}

function normalizeHomeLayout(saved: unknown, items: LaunchpadItem[]): HomeLayoutState {
  const ids = items.map(itemId);
  const validIds = new Set(ids);
  const fallbackFavorites = ids.slice(0, Math.min(4, ids.length));

  if (!saved || typeof saved !== "object") {
    return {
      order: ids,
      favoriteIds: fallbackFavorites,
      favoriteOrder: fallbackFavorites,
      usage: {},
    };
  }

  const source = saved as Partial<HomeLayoutState>;
  const order = Array.isArray(source.order)
    ? [...source.order.filter((id) => validIds.has(id)), ...ids.filter((id) => !source.order?.includes(id))]
    : ids;

  const favoriteIds = Array.isArray(source.favoriteIds)
    ? source.favoriteIds.filter((id) => validIds.has(id))
    : fallbackFavorites;
  const effectiveFavoriteIds = favoriteIds.length ? favoriteIds : fallbackFavorites;

  const favoriteOrder = Array.isArray(source.favoriteOrder)
    ? [
        ...source.favoriteOrder.filter((id) => effectiveFavoriteIds.includes(id) && validIds.has(id)),
        ...effectiveFavoriteIds.filter((id) => !source.favoriteOrder?.includes(id)),
      ]
    : effectiveFavoriteIds;

  const usage = source.usage && typeof source.usage === "object"
    ? Object.fromEntries(Object.entries(source.usage).filter(([id]) => validIds.has(id)))
    : {};

  return { order, favoriteIds: effectiveFavoriteIds, favoriteOrder, usage };
}

function SortableAppTile({
  sortableId,
  item,
  accentIndex,
  favorite,
  compact = false,
  onOpen,
  onToggleFavorite,
}: {
  sortableId: string;
  item: LaunchpadItem;
  accentIndex: number;
  favorite: boolean;
  compact?: boolean;
  onOpen: (item: LaunchpadItem) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId });
  const Icon = item.icon;
  const accent = TILE_ACCENTS[accentIndex % TILE_ACCENTS.length];

  const style: CSSProperties = {
    "--tile-from": accent.from,
    "--tile-to": accent.to,
    "--tile-glow": accent.glow,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.76 : 1,
    zIndex: isDragging ? 6 : 1,
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={compact ? "home-app-sortable home-app-sortable-compact" : "home-app-sortable"}
      data-dragging={isDragging ? "true" : "false"}
    >
      <button
        type="button"
        className={compact ? "home-app-tile compact" : "home-app-tile"}
        onClick={() => onOpen(item)}
        {...attributes}
        {...listeners}
      >
        <span className="home-app-icon">
          <Icon size={compact ? 31 : 36} strokeWidth={1.75} />
        </span>
        <span className="home-app-title">{item.label}</span>
      </button>
      <button
        type="button"
        className={favorite ? "home-favorite-toggle active" : "home-favorite-toggle"}
        aria-label={favorite ? `Rimuovi ${item.label} dai preferiti` : `Aggiungi ${item.label} ai preferiti`}
        title={favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(itemId(item));
        }}
      >
        <Star size={14} strokeWidth={2.1} fill={favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { user, isModuleEnabled } = useAuth();
  const [layout, setLayout] = useState<HomeLayoutState | null>(null);

  const navGroups = useMemo(() => {
    return getVisibleNavGroups({
      role: user?.ruolo,
      isModuleEnabled,
    });
  }, [isModuleEnabled, user?.ruolo]);

  const items = useMemo(
    () => navGroups.flatMap((group) => group.items.map((item) => ({ ...item, section: group.section }))),
    [navGroups],
  );

  const storageKey = useMemo(() => {
    const identity = user?.userid ?? user?.username ?? "guest";
    const tenant = user?.tenant_id ?? "global";
    return `${HOME_LAYOUT_STORAGE_VERSION}.${tenant}.${identity}`;
  }, [user?.tenant_id, user?.userid, user?.username]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!items.length) return;
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem(storageKey) || "null");
      } catch {
        return null;
      }
    })();
    const normalized = normalizeHomeLayout(saved, items);
    // TODO(sec-04): revisione umana - init layout da localStorage all'allineamento utente/moduli
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(normalized);
    localStorage.setItem(storageKey, JSON.stringify(normalized));
  }, [items, storageKey]);

  const updateLayout = (updater: (current: HomeLayoutState) => HomeLayoutState) => {
    setLayout((current) => {
      if (!current) return current;
      const next = updater(current);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const itemsById = useMemo(() => new Map(items.map((item) => [itemId(item), item])), [items]);
  const favoriteSet = useMemo(() => new Set(layout?.favoriteIds ?? []), [layout?.favoriteIds]);

  const orderedItems = useMemo(() => {
    const order = layout?.order ?? items.map(itemId);
    return order.map((id) => itemsById.get(id)).filter((item): item is LaunchpadItem => Boolean(item));
  }, [items, itemsById, layout?.order]);

  const favoriteItems = useMemo(() => {
    const favoriteOrder = layout?.favoriteOrder ?? [];
    return favoriteOrder.map((id) => itemsById.get(id)).filter((item): item is LaunchpadItem => Boolean(item));
  }, [itemsById, layout?.favoriteOrder]);

  const toggleFavorite = (id: string) => {
    updateLayout((current) => {
      const isFavorite = current.favoriteIds.includes(id);
      if (isFavorite) {
        const favoriteIds = current.favoriteIds.filter((item) => item !== id);
        return {
          ...current,
          favoriteIds,
          favoriteOrder: current.favoriteOrder.filter((item) => item !== id),
        };
      }

      return {
        ...current,
        favoriteIds: [...current.favoriteIds, id],
        favoriteOrder: [...current.favoriteOrder, id],
      };
    });
  };

  const openItem = (item: LaunchpadItem) => {
    const id = itemId(item);
    updateLayout((current) => ({
      ...current,
      usage: { ...current.usage, [id]: (current.usage[id] ?? 0) + 1 },
    }));
    router.push(item.href);
  };

  const handleAppsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).replace("app:", "");
    const overId = String(over.id).replace("app:", "");

    updateLayout((current) => {
      const oldIndex = current.order.indexOf(activeId);
      const newIndex = current.order.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return { ...current, order: arrayMove(current.order, oldIndex, newIndex) };
    });
  };

  const handleFavoritesDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).replace("fav:", "");
    const overId = String(over.id).replace("fav:", "");

    updateLayout((current) => {
      const oldIndex = current.favoriteOrder.indexOf(activeId);
      const newIndex = current.favoriteOrder.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return { ...current, favoriteOrder: arrayMove(current.favoriteOrder, oldIndex, newIndex) };
    });
  };

  return (
    <div className="home-launchpad">
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-kicker">
            <Sparkles size={14} strokeWidth={1.8} />
            MaintAI Home
          </div>
          <h1>Ciao, {user?.username ?? "utente"}.</h1>
          <p>Le funzioni principali sono sempre qui: grandi, rapide e ordinate come preferisci.</p>
        </div>
      </section>

      {favoriteItems.length > 0 && (
        <section className="home-section home-favorites-section">
          <div className="home-section-heading">
            <div>
              <h2>Preferiti</h2>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFavoritesDragEnd}>
            <SortableContext items={favoriteItems.map((item) => `fav:${itemId(item)}`)} strategy={rectSortingStrategy}>
              <div className="home-app-grid favorites">
                {favoriteItems.map((item, index) => (
                  <SortableAppTile
                    key={`fav:${itemId(item)}`}
                    sortableId={`fav:${itemId(item)}`}
                    item={item}
                    accentIndex={index}
                    favorite={favoriteSet.has(itemId(item))}
                    compact
                    onOpen={openItem}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      )}

      <section className="home-section">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAppsDragEnd}>
          <SortableContext items={orderedItems.map((item) => `app:${itemId(item)}`)} strategy={rectSortingStrategy}>
            <div className="home-app-grid">
              {orderedItems.map((item, index) => (
                <SortableAppTile
                  key={`app:${itemId(item)}`}
                  sortableId={`app:${itemId(item)}`}
                  item={item}
                  accentIndex={index}
                  favorite={favoriteSet.has(itemId(item))}
                  onOpen={openItem}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </div>
  );
}
