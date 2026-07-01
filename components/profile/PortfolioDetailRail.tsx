"use client";

import type { BackendPortfolioItem } from "../../lib/backendClient";
import PortfolioPreviewRail from "./PortfolioPreviewRail";
import { usePortfolioDetailPopup } from "./PortfolioDetailPopup";

type PortfolioDetailRailProps = {
  items: BackendPortfolioItem[];
  ariaLabel?: string;
  keyPrefix?: string;
  itemControlsId?: string;
  showCreatedDateFallback?: boolean;
};

export default function PortfolioDetailRail({
  items,
  ariaLabel = "Portfolio preview",
  keyPrefix = "portfolio-preview",
  itemControlsId = "portfolio-detail-popup",
  showCreatedDateFallback = true,
}: PortfolioDetailRailProps) {
  const popup = usePortfolioDetailPopup(itemControlsId);

  return (
    <>
      <PortfolioPreviewRail
        items={items}
        onItemActivate={popup.open}
        activeItemId={popup.activeItemId}
        itemControlsId={popup.popoverId}
        ariaLabel={ariaLabel}
        keyPrefix={keyPrefix}
        externalLinkLabelPrefix="View portfolio project details"
        internalLinkLabelPrefix="View portfolio project details"
        showCreatedDateFallback={showCreatedDateFallback}
      />
      {popup.popover}
    </>
  );
}
