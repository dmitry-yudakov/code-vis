import { FC, SyntheticEvent } from 'react';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/CloseOutlined';

export const CloseButton: FC<{ onClick: (e: SyntheticEvent) => void }> = ({
  onClick,
}) => (
  <IconButton onClick={onClick}>
    <CloseIcon />
  </IconButton>
);
