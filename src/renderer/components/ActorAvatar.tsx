/**
 * 轻量头像：取名称首字母，用于卡片 / 评论 gutter。
 */
export function ActorAvatar({
  name,
  kind = "agent",
  size = "sm",
}: {
  name: string;
  kind?: "agent" | "human" | "squad";
  size?: "sm" | "md";
}) {
  const letter = (name?.trim()?.[0] || "?").toUpperCase();
  return (
    <span
      className={`actor-avatar actor-avatar-${size} actor-avatar-${kind}`}
      aria-hidden
      title={name}
    >
      {letter}
    </span>
  );
}
