import React from 'react';
import { Header } from './Header';

type Props = {
  title: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
};

export const OwnerPageHeader: React.FC<Props> = ({ title, leftSlot, rightSlot }) => {
  return <Header title={title} subtitle={leftSlot} action={rightSlot} />;
};
